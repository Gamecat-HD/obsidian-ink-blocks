import { debounce, normalizePath, TFile, TFolder, type Debouncer, type TAbstractFile } from "obsidian";
import type InkBlocksPlugin from "../main";
import { History } from "../model/history";
import { decodeInk, encodeInk, type InkData } from "../model/ink-format";
import { mergeInk } from "../model/merge";
import { reuseStrokes } from "../model/reuse";
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
	/** Neuere Erkennung, die nicht geschrieben wurde, weil `text:` von Hand geändert ist (nur im Speicher). */
	ocrPending?: string;
	/** Aufgedeckte Abdeckbänder – nur für diese Sitzung, nicht gespeichert (Lernen: beim nächsten Öffnen wieder zu). */
	revealed: Set<string>;
	/** Block war aktiv, als der Blockinhalt (z. B. `text:`) geschrieben wurde → nach dem Re-Render wieder aktivieren. */
	reactivate?: boolean;
}

interface Entry extends InkEntry {
	refs: number;
	listeners: Set<InkListener>;
	/**
	 * Stand der Datei, wie er zuletzt gelesen oder geschrieben wurde – Basis für den Merge. Es zählen nur die
	 * Strich-IDs (siehe mergeInk), daher genügt eine flache Kopie statt die Datei erneut zu dekodieren.
	 */
	base: InkData;
	lastWritten: string;
	save: Debouncer<[], Promise<void>>;
	evictTimer?: number;
	/**
	 * Lesen (fremde Änderung) und Schreiben laufen pro Datei nacheinander. Sonst könnte eine langsam gelesene,
	 * inzwischen veraltete Fassung den eigenen, gerade gespeicherten Strich wieder überschreiben.
	 */
	queue: Promise<void>;
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

	/** Ausstehende Änderungen einer Datei sofort speichern (api.flush). */
	async flush(path: string) {
		const e = this.entries.get(path);
		if (e) await e.save.run();
	}

	/** Aktueller Stand einer geladenen Datei, ohne sie zu laden. */
	peek(path: string): InkData | undefined {
		return this.entries.get(path)?.doc;
	}

	/** Beim Entladen: ausstehende Saves sofort, Timer weg. */
	dispose() {
		for (const e of this.entries.values()) {
			window.clearTimeout(e.evictTimer);
			void e.save.run();
		}
		this.entries.clear();
	}

	/**
	 * Eintrag verwerfen, bevor die Datei gelöscht wird: ausstehendes Speichern abbrechen, damit es die Datei
	 * nicht neu anlegt. Blöcke, die ihn noch halten, geben ihn beim Entladen folgenlos frei.
	 */
	discard(path: string) {
		const entry = this.entries.get(path);
		if (!entry) return;
		entry.save.cancel();
		entry.dirty = false;
		window.clearTimeout(entry.evictTimer);
		this.entries.delete(path);
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
			revealed: new Set(),
			refs: 0,
			listeners: new Set(),
			base: snapshot(doc),
			lastWritten: text,
			save: debounce(() => this.serial(entry, () => this.write(entry)), SAVE_DELAY, true),
			queue: Promise.resolve(),
		};
		this.entries.set(path, entry);
		return entry;
	}

	/**
	 * `fn` exklusiv für diese Datei ausführen – nicht gleichzeitig mit eigenem Lesen/Speichern (api.exclusive).
	 * Andere Plugins, die die .ink-Datei schreiben (Tandem), vermeiden so verlorene Änderungen.
	 */
	exclusive<T>(path: string, fn: () => Promise<T> | T): Promise<T> {
		const entry = this.entries.get(path);
		if (!entry) return Promise.resolve().then(fn);
		const run = entry.queue.then(fn, fn);
		entry.queue = run.then(
			() => {},
			() => {},
		);
		return run;
	}

	private serial(entry: Entry, fn: () => Promise<void>): Promise<void> {
		const next = entry.queue.then(fn, fn).catch((e) => console.warn(`[ink-blocks] ${entry.path}`, e));
		entry.queue = next;
		return next;
	}

	/**
	 * Speichern als atomares Lesen-Ändern-Schreiben (`vault.process`): Hat jemand anderes die Datei seit dem
	 * letzten Lesen geändert (Sync, Zusammenarbeit), wird diese Fassung per mergeInk eingearbeitet statt blind
	 * überschrieben. `dirty` wird erst hier zurückgesetzt – bis dahin führt onModify zusammen, statt zu ersetzen.
	 */
	private async write(entry: Entry) {
		if (!entry.dirty) return;
		const file = this.plugin.app.vault.getFileByPath(entry.path);
		if (!file) return;
		let merged = false;
		let historyInvalid = false;
		await this.plugin.app.vault.process(file, (data) => {
			if (data !== entry.lastWritten) {
				try {
					const remote = reuseStrokes(entry.doc.strokes, decodeInk(data));
					const after = new Set(remote.strokes.map((s) => s.id));
					historyInvalid = entry.base.strokes.some((s) => !after.has(s.id));
					entry.doc = mergeInk(entry.base, entry.doc, remote);
					merged = true;
				} catch (e) {
					console.warn(`[ink-blocks] ${entry.path}: Datei nicht lesbar, wird überschrieben`, e);
				}
			}
			entry.dirty = false;
			const text = encodeInk(entry.doc);
			entry.lastWritten = text;
			entry.base = snapshot(entry.doc);
			return text;
		});
		if (merged) {
			if (historyInvalid) entry.history.clear();
			this.emit(entry, "reloaded");
			this.plugin.api?.docChanged(entry.path);
		}
	}

	private emit(entry: Entry, event: InkEvent) {
		for (const fn of [...entry.listeners]) fn(event);
	}

	private async onModify(file: TAbstractFile) {
		const entry = this.entries.get(file.path);
		if (!entry || !(file instanceof TFile)) return;
		await this.serial(entry, () => this.applyExternal(entry, file));
	}

	private async applyExternal(entry: Entry, file: TFile) {
		if (this.entries.get(entry.path) !== entry) return;
		const text = await this.plugin.app.vault.read(file);
		if (text === entry.lastWritten) return; // eigener Schreibvorgang
		let remote: InkData;
		try {
			// Unveränderte Striche behalten ihr Objekt (Pfad-Cache, Kacheln malen nur Neues neu)
			remote = reuseStrokes(entry.doc.strokes, decodeInk(text));
		} catch (e) {
			console.warn(`[ink-blocks] ${file.path}: externe Änderung nicht lesbar, wird ignoriert`, e);
			return;
		}
		// Hat die fremde Änderung nur Striche hinzugefügt (jemand anderes zeichnet mit), bleiben die eigenen
		// Ops gültig – sie beziehen sich auf Strich-IDs. Wurde etwas entfernt, ist Undo nicht mehr sicher.
		const before = new Set(entry.base.strokes.map((s) => s.id));
		const after = new Set(remote.strokes.map((s) => s.id));
		const onlyAdded = [...before].every((id) => after.has(id));
		// Lokale, noch nicht gespeicherte Änderungen: gespeichert (dirty) ODER gerade in Arbeit (z. B. Radierer-Geste,
		// die Striche schon während der Bewegung entfernt) → zusammenführen statt ersetzen.
		const local = entry.dirty || [...this.plugin.editors].some((e) => e.entry === entry && e.busy);
		entry.doc = local ? mergeInk(entry.base, entry.doc, remote) : remote;
		entry.base = snapshot(remote);
		if (!onlyAdded) entry.history.clear();
		entry.lastWritten = text;
		this.emit(entry, "reloaded");
		this.plugin.api?.docChanged(entry.path);
		if (entry.dirty) void entry.save();
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

/** Flache Kopie als Merge-Basis: eigenes Strich-Array, gleiche (unveränderliche) Strich-Objekte. */
function snapshot(doc: InkData): InkData {
	return { ...doc, strokes: doc.strokes.slice() };
}
