import { MarkdownRenderChild, normalizePath, type MarkdownPostProcessorContext, type TAbstractFile, type TFile } from "obsidian";
import type InkBlocksPlugin from "../main";
import { InkFormatError } from "../model/ink-format";
import type { OcrTarget } from "../ocr/OcrService";
import { backgroundKind, measureBackground } from "../render/background";
import { patternFields, resolvePattern, type Pattern, type PatternChange } from "../model/pattern";
import type { InkEntry, InkEvent } from "../store/InkStore";
import { ExpandModal } from "../ui/ExpandModal";
import { parseBgLink } from "./bgLink";
import { InkEditor, type ResolvedBackground } from "./InkEditor";
import { writeBlockFields } from "./BlockWriter";
import { parseBlock, type BlockFields } from "./source";

/**
 * Ein gerenderter ```ink-Block. Der Zustand (Dokument, Undo) lebt im InkStore – Live Preview baut
 * diese Instanz bei jeder Änderung am Blockinhalt neu auf (siehe docs/SPIKES.md, S4).
 */
export class InkBlockChild extends MarkdownRenderChild {
	private entry: InkEntry | null = null;
	private editor: InkEditor | null = null;
	private fields: BlockFields;
	private alive = false;

	constructor(
		containerEl: HTMLElement,
		source: string,
		private readonly ctx: MarkdownPostProcessorContext,
		private readonly plugin: InkBlocksPlugin,
	) {
		super(containerEl);
		this.fields = parseBlock(source);
	}

	get path(): string | null {
		return this.fields.file ? normalizePath(this.fields.file) : null;
	}

	onload() {
		this.alive = true;
		this.plugin.blocks.add(this);
		this.plugin.dev.loaded++;
		this.containerEl.addClass("ink-block");
		// Auf dem ganzen Block, damit Strg+Z auch nach Klicks auf die Leiste greift.
		this.registerDomEvent(this.containerEl, "keydown", this.onKeyDown);
		this.containerEl.dataset.instance = String(this.plugin.dev.loaded);
		void this.mount();
	}

	onunload() {
		this.alive = false;
		this.plugin.blocks.delete(this);
		this.plugin.dev.unloaded++;
		this.teardown();
		if (this.entry) this.plugin.store.release(this.entry, this.onStoreEvent);
		this.entry = null;
	}

	/** Nach Theme- oder Einstellungswechsel neu zeichnen. */
	refresh() {
		this.editor?.refresh();
		if (this.editor) this.renderCaption();
	}

	/** Erkannter Text (aus `text:`) dezent unter der Fläche; Klick klappt auf/zu. */
	private renderCaption() {
		this.containerEl.querySelector(":scope > .ink-caption")?.remove();
		const text = this.fields.text?.trim();
		if (!text || !this.plugin.settings.showText) return;
		const caption = this.containerEl.createDiv({ cls: "ink-caption", attr: { "aria-label": "Erkannter Text" } });
		caption.setText(text);
		for (const type of ["pointerdown", "mousedown", "touchstart"]) caption.addEventListener(type, (e) => e.stopPropagation());
		caption.addEventListener("click", (e) => {
			e.stopPropagation();
			caption.toggleClass("is-expanded", !caption.hasClass("is-expanded"));
		});
	}

	/** Deaktiviert den Block, wenn `target` außerhalb liegt. */
	deactivateUnless(target: Node) {
		if (!this.containerEl.contains(target)) this.containerEl.removeClass("is-active");
	}

	private get pattern(): Pattern {
		return resolvePattern(this.fields, this.plugin.settings);
	}

	private teardown() {
		this.editor?.destroy();
		this.editor = null;
	}

	private async mount() {
		const path = this.path;
		if (!path) return this.showMessage("Kein `file:` im ink-Block angegeben.");

		let entry: InkEntry | null;
		try {
			entry = await this.plugin.store.acquire(path, this.onStoreEvent);
		} catch (e) {
			const reason = e instanceof InkFormatError ? e.message : String(e);
			return this.showMessage(`Ink-Datei beschädigt: ${path}`, reason);
		}
		if (!this.alive) {
			if (entry) this.plugin.store.release(entry, this.onStoreEvent);
			return;
		}
		if (!entry) {
			this.showMessage(`Ink-Datei fehlt: ${path}`, "Wird angezeigt, sobald die Datei auftaucht (z. B. nach dem Sync).");
			this.waitForFile(path);
			return;
		}
		this.entry = entry;
		this.render();
	}

	private waitForFile(path: string) {
		const ref = this.plugin.app.vault.on("create", (file: TAbstractFile) => {
			if (file.path !== path) return;
			this.plugin.app.vault.offref(ref);
			void this.mount();
		});
		this.registerEvent(ref);
	}

	private readonly onStoreEvent = (event: InkEvent) => {
		if (event === "deleted") {
			this.teardown();
			this.entry = null;
			void this.mount();
		} else if (this.entry) {
			// Neu geladen (Sync) oder in einer anderen Ansicht derselben Datei geändert.
			this.editor?.setDoc();
		}
	};

	private commit() {
		const entry = this.entry;
		if (!entry) return;
		this.plugin.store.touch(entry);
		this.plugin.store.changed(entry, this.onStoreEvent);
		const target = this.ocrTarget();
		if (target) this.plugin.ocr.schedule(target);
	}

	/** Ziel für die Texterkennung. Bleibt gültig, auch wenn dieser Block inzwischen neu gerendert wurde. */
	ocrTarget(): OcrTarget | null {
		const entry = this.entry;
		const inkPath = this.path;
		if (!entry || !inkPath) return null;
		const { containerEl, ctx } = this;
		return {
			entry,
			inkPath,
			notePath: ctx.sourcePath,
			hint: () => (containerEl.isConnected ? ctx.getSectionInfo(containerEl)?.lineStart : undefined),
			busy: () => [...this.plugin.editors].some((e) => e.entry === entry && e.busy),
			beforeWrite: () => {
				for (const b of this.plugin.blocks) {
					if (b.entry !== entry) continue;
					if (b.containerEl.hasClass("is-active")) entry.reactivate = true;
					b.releaseFocus();
				}
			},
		};
	}

	private readonly activate = () => {
		this.containerEl.addClass("is-active");
		this.editor?.surface.el.focus({ preventScroll: true });
	};

	/** Große Schreibfläche im Dialog öffnen (gleiche Datei, Texterkennung zielt weiter auf diesen Block). */
	private expand() {
		const path = this.path;
		// Ziel jetzt festhalten: Diese Instanz wird beim nächsten Neu-Rendern des Blocks (z. B. nach der
		// Texterkennung) entladen, `ocrTarget()` liefert dann null. Das Ziel selbst bleibt gültig.
		const target = this.ocrTarget();
		if (!path || !this.entry || !target) return;
		this.releaseFocus();
		new ExpandModal({
			plugin: this.plugin,
			inkPath: path,
			pattern: () => this.pattern,
			setPattern: (change) => this.setPattern(change),
			background: this.resolveBackground(),
			ocrTarget: () => target,
		}).open();
	}

	/**
	 * Fokus/Auswahl aus dem Widget nehmen, bevor der Blockinhalt geschrieben wird – sonst übernimmt
	 * CodeMirror beim Re-Render die DOM-Auswahl und Live Preview klappt den Block in den Quelltext auf.
	 */
	releaseFocus() {
		const active = document.activeElement;
		if (active instanceof HTMLElement && this.containerEl.contains(active)) active.blur();
		const sel = window.getSelection();
		if (sel?.anchorNode && this.containerEl.contains(sel.anchorNode)) sel.removeAllRanges();
		this.containerEl.removeClass("is-active");
	}

	private readonly onKeyDown = (e: KeyboardEvent) => {
		const mod = e.ctrlKey || e.metaKey;
		const key = e.key.toLowerCase();
		let handled = true;
		if (mod && key === "z" && !e.shiftKey) this.editor?.undo();
		else if (mod && ((key === "z" && e.shiftKey) || key === "y")) this.editor?.redo();
		else if (e.key === "Escape") {
			this.containerEl.removeClass("is-active");
			this.editor?.surface.el.blur();
		} else handled = false;
		if (handled) {
			// Nicht an CodeMirror weiterreichen – sonst würde zusätzlich der Notiztext rückgängig gemacht.
			e.preventDefault();
			e.stopPropagation();
		}
	};

	private setPattern(change: PatternChange) {
		const path = this.path;
		if (!path) return;
		const fields = patternFields(this.pattern, change);
		if (!Object.keys(fields).length) return;
		const hint = this.ctx.getSectionInfo(this.containerEl)?.lineStart;
		// Live Preview rendert den Block danach neu; Dokument und Undo bleiben im Store.
		Object.assign(this.fields, fields);
		this.editor?.refresh();
		this.releaseFocus();
		void writeBlockFields(this.plugin.app, this.ctx.sourcePath, path, fields, hint);
	}

	private render() {
		const entry = this.entry;
		if (!entry) return;
		this.teardown();
		this.containerEl.empty();
		this.containerEl.removeClass("is-message");
		const background = this.resolveBackground();
		// Leeres Heft mit nachträglich eingetragenem bg: → in ein Arbeitsblatt umwandeln.
		if (background && !("error" in background) && entry.doc.space === "nb" && entry.doc.strokes.length === 0) {
			void this.convertToPage(entry, background.file, background.page);
		}
		this.editor = new InkEditor(this.containerEl, {
			plugin: this.plugin,
			entry,
			pattern: () => this.pattern,
			setPattern: (change) => this.setPattern(change),
			background: entry.doc.space === "page" || !background || "error" in background ? background : null,
			commit: () => this.commit(),
			activate: this.activate,
			toggleExpand: () => this.expand(),
		});
		this.renderCaption();
		if (entry.reactivate) {
			entry.reactivate = false;
			this.activate();
		}
	}

	/** `bg:`-Link auflösen (relativ zur Notiz); `null` + Fehlermeldung, wenn die Datei fehlt. */
	private resolveBackground(): ResolvedBackground {
		const link = parseBgLink(this.fields.bg);
		if (!link) return null;
		const file = this.plugin.app.metadataCache.getFirstLinkpathDest(link.linkpath, this.ctx.sourcePath);
		if (!file) return { error: `Hintergrund nicht gefunden: ${link.linkpath}` };
		if (!backgroundKind(file)) return { error: `Kein PDF/Bild: ${file.path}` };
		return { file, page: link.page ?? 1 };
	}

	private async convertToPage(entry: InkEntry, file: TFile, page: number) {
		try {
			const info = await measureBackground(this.plugin.app, file, page);
			if (!this.alive || this.entry !== entry || entry.doc.strokes.length) return;
			Object.assign(entry.doc, { space: "page", w: info.pw, h: info.ph, bg: info });
			entry.history.clear();
			this.plugin.store.touch(entry);
			this.plugin.store.changed(entry, this.onStoreEvent);
			this.render();
		} catch (e) {
			this.editor?.surface.showOverlay(`Hintergrund: ${(e as Error).message}`);
		}
	}

	private showMessage(title: string, detail?: string) {
		this.teardown();
		this.containerEl.empty();
		this.containerEl.addClass("is-message");
		const box = this.containerEl.createDiv({ cls: "ink-message" });
		box.createDiv({ cls: "ink-message-title", text: title });
		if (detail) box.createDiv({ cls: "ink-message-detail", text: detail });
	}
}
