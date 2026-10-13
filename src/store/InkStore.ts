import { debounce, normalizePath, TFile, TFolder, type Debouncer, type TAbstractFile } from "obsidian";
import type InkBlocksPlugin from "../main";
import { History } from "../model/history";
import { decodeInk, encodeInk, type InkData } from "../model/ink-format";
import { mergeInk } from "../model/merge";
import { formatBgLink, linkMatchesPath, parseBgLink } from "../block/bgLink";
import { findInkFences, replaceFenceBody } from "../block/locate";
import { parseBlock, setField } from "../block/source";
import { backgroundKind } from "../render/background";

export type InkEvent = "reloaded" | "deleted" | "changed";
export type InkListener = (event: InkEvent) => void;

/** Geteilter Zustand einer .ink-Datei. Alle Blöcke, die dieselbe Datei zeigen, arbeiten auf demselben Eintrag. */
export interface InkEntry {
	path: string;
	doc: InkData;
	dirty: boolean;
	/** Liegt hier (nicht im Block), damit Undo ein Neu-Rendern in Live Preview übersteht. */
	history: History;
}

interface Entry extends InkEntry {
	refs: number;
	listeners: Set<InkListener>;
	/** Stand der Datei, wie er zuletzt gelesen oder geschrieben wurde – Basis für den Merge. */
	base: InkData;
	lastWritten: string;
	save: Debouncer<[], Promise<void>>;
	evictTimer?: number;
}

const SAVE_DELAY = 1500;
/** Unbenutzte Einträge bleiben so lange im Speicher – Live Preview baut Blöcke bei Edits neu auf, Undo soll das überleben. */
const EVICT_DELAY = 10_000;

export class InkStore {
	private readonly entries = new Map<string, Entry>();
	private readonly loading = new Map<string, Promise<Entry | null>>();

	constructor(private readonly plugin: InkBlocksPlugin) {
		const { vault } = plugin.app;
		plugin.registerEvent(vault.on("modify", (f) => void this.onModify(f)));
		plugin.registerEvent(vault.on("delete", (f) => this.onDelete(f)));
		plugin.registerEvent(vault.on("rename", (f, oldPath) => void this.onRename(f, oldPath)));
	}

	/** Lädt (oder teilt) den Eintrag; `null`, wenn die Datei (noch) nicht existiert. Wirft bei kaputter Datei. */
	async acquire(path: string, listener: InkListener): Promise<InkEntry | null> {
		let entry = this.entries.get(path);
		if (!entry) {
			let pending = this.loading.get(path);
			if (!pending) {
				pending = this.load(path).finally(() => this.loading.delete(path));
				this.loading.set(path, pending);
			}
			entry = (await pending) ?? undefined;
			if (!entry) return null;
		}
		window.clearTimeout(entry.evictTimer);
		entry.evictTimer = undefined;
		entry.refs++;
		entry.listeners.add(listener);
		return entry;
	}

	release(entry: InkEntry, listener: InkListener) {
		const e = this.entries.get(entry.path);
		if (!e) return;
		e.listeners.delete(listener);
		if (--e.refs <= 0) {
			e.save.run();
			e.evictTimer = window.setTimeout(() => {
				if (e.refs <= 0 && this.entries.get(e.path) === e) this.entries.delete(e.path);
			}, EVICT_DELAY);
		}
	}

	/** Markiert eine Änderung; gespeichert wird gebündelt nach SAVE_DELAY. */
	touch(entry: InkEntry) {
		const e = this.entries.get(entry.path);
		if (!e) return;
		e.dirty = true;
		e.save();
	}

	/** Andere Blöcke derselben Datei über eine lokale Änderung informieren. */
	changed(entry: InkEntry, source: InkListener) {
		const e = this.entries.get(entry.path);
		if (!e) return;
		for (const fn of [...e.listeners]) if (fn !== source) fn("changed");
	}

	async flushAll() {
		await Promise.all([...this.entries.values()].map((e) => e.save.run()));
	}

	/** Beim Entladen: ausstehende Saves sofort, Timer weg. */
	dispose() {
		for (const e of this.entries.values()) {
			window.clearTimeout(e.evictTimer);
			void e.save.run();
		}
		this.entries.clear();
	}

	/** Legt eine neue .ink-Datei an (inkl. Ordner). */
	async create(path: string, doc: InkData): Promise<TFile> {
		const { vault } = this.plugin.app;
		const folder = path.split("/").slice(0, -1).join("/");
		if (folder && !vault.getFolderByPath(folder)) await vault.createFolder(folder);
		return vault.create(path, encodeInk(doc));
	}

	private async load(path: string): Promise<Entry | null> {
		const file = this.plugin.app.vault.getFileByPath(path);
		if (!file) return null;
		const text = await this.plugin.app.vault.read(file);
		const doc = decodeInk(text);
		const entry: Entry = {
			path,
			doc,
			dirty: false,
			history: new History(),
			refs: 0,
			listeners: new Set(),
			base: decodeInk(text),
			lastWritten: text,
			save: debounce(() => this.write(entry), SAVE_DELAY, true),
		};
		this.entries.set(path, entry);
		return entry;
	}

	private async write(entry: Entry) {
		if (!entry.dirty) return;
		const file = this.plugin.app.vault.getFileByPath(entry.path);
		if (!file) return;
		const text = encodeInk(entry.doc);
		entry.dirty = false;
		if (text === entry.lastWritten) return;
		entry.lastWritten = text;
		entry.base = decodeInk(text);
		await this.plugin.app.vault.modify(file, text);
	}

	private emit(entry: Entry, event: InkEvent) {
		for (const fn of [...entry.listeners]) fn(event);
	}

	private async onModify(file: TAbstractFile) {
		const entry = this.entries.get(file.path);
		if (!entry || !(file instanceof TFile)) return;
		const text = await this.plugin.app.vault.read(file);
		if (text === entry.lastWritten) return; // eigener Schreibvorgang
		let remote: InkData;
		try {
			remote = decodeInk(text);
		} catch (e) {
			console.warn(`[ink-blocks] ${file.path}: externe Änderung nicht lesbar, wird ignoriert`, e);
			return;
		}
		entry.doc = entry.dirty ? mergeInk(entry.base, entry.doc, remote) : remote;
		entry.base = remote;
		// Ops beziehen sich auf den alten Stand – nach fremden Änderungen nicht mehr sicher umkehrbar.
		entry.history.clear();
		entry.lastWritten = text;
		this.emit(entry, "reloaded");
		if (entry.dirty) entry.save();
	}

	private onDelete(file: TAbstractFile) {
		const entry = this.entries.get(file.path);
		if (!entry) return;
		entry.save.cancel();
		window.clearTimeout(entry.evictTimer);
		this.entries.delete(file.path);
		this.emit(entry, "deleted");
	}

	/**
	 * Umbenannte/verschobene .ink-Dateien, Hintergründe (PDF/Bild) oder Ordner: `file:`- und `bg:`-Felder
	 * in den ink-Blöcken aller Notizen nachziehen. Obsidian aktualisiert Links in Codeblöcken nicht selbst.
	 */
	private async onRename(file: TAbstractFile, oldPath: string) {
		const isFolder = file instanceof TFolder;
		const isInk = file instanceof TFile && file.extension === "ink";
		const bgFile = file instanceof TFile && backgroundKind(file) ? file : null;
		if (!isFolder && !isInk && !bgFile) return;

		for (const [path, entry] of [...this.entries]) {
			const moved = path === oldPath ? file.path : isFolder && path.startsWith(oldPath + "/") ? file.path + path.slice(oldPath.length) : null;
			if (!moved) continue;
			this.entries.delete(path);
			entry.path = moved;
			this.entries.set(moved, entry);
		}

		const movedPath = (p: string): string | null =>
			p === oldPath ? file.path : isFolder && p.startsWith(oldPath + "/") ? file.path + p.slice(oldPath.length) : null;
		const { vault, metadataCache } = this.plugin.app;
		const needle = isFolder || isInk ? oldPath : (oldPath.split("/").pop() ?? oldPath);

		const rewrite = (data: string, notePath: string): string => {
			for (const fence of findInkFences(data).reverse()) {
				let body = fence.body;
				const fields = parseBlock(body);
				if (fields.file && (isInk || isFolder)) {
					const moved = movedPath(normalizePath(fields.file));
					if (moved) body = setField(body, "file", moved);
				}
				const link = parseBgLink(fields.bg);
				if (link) {
					if (bgFile && linkMatchesPath(link.linkpath, oldPath)) {
						body = setField(body, "bg", formatBgLink(metadataCache.fileToLinktext(bgFile, notePath, false), link.page));
					} else if (isFolder) {
						const moved = movedPath(link.linkpath);
						if (moved) body = setField(body, "bg", formatBgLink(moved, link.page));
					}
				}
				if (body !== fence.body) data = replaceFenceBody(data, fence, body);
			}
			return data;
		};

		for (const note of vault.getMarkdownFiles()) {
			const text = await vault.cachedRead(note);
			if (!text.includes(needle) || !text.includes("ink")) continue;
			await vault.process(note, (data) => rewrite(data, note.path));
		}
	}
}
