import { MarkdownRenderChild, normalizePath, type MarkdownPostProcessorContext, type TAbstractFile, type TFile } from "obsidian";
import { PointerPipeline } from "../input/PointerPipeline";
import type InkBlocksPlugin from "../main";
import { InkFormatError } from "../model/ink-format";
import type { OcrTarget } from "../ocr/OcrService";
import { opBounds, type InkOp } from "../model/ops";
import { backgroundKind, measureBackground, PageBackground } from "../render/background";
import { Surface } from "../render/Surface";
import type { BgStyle } from "../settings";
import type { InkEntry, InkEvent } from "../store/InkStore";
import { Toolbar } from "../ui/Toolbar";
import { parseBgLink } from "./bgLink";
import { writeBlockField } from "./BlockWriter";
import { parseBlock, type BlockFields } from "./source";

const BG_CYCLE: BgStyle[] = ["ruled", "grid", "blank"];

/**
 * Ein gerenderter ```ink-Block. Der Zustand (Dokument, Undo) lebt im InkStore – Live Preview baut
 * diese Instanz bei jeder Änderung am Blockinhalt neu auf (siehe docs/SPIKES.md, S4).
 */
export class InkBlockChild extends MarkdownRenderChild {
	private entry: InkEntry | null = null;
	private surface: Surface | null = null;
	private pipeline: PointerPipeline | null = null;
	private toolbar: Toolbar | null = null;
	private background: PageBackground | null = null;
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
		this.surface?.setBgStyle(this.bgStyle);
		this.surface?.redrawAll();
		this.toolbar?.update();
		if (this.surface) this.renderCaption();
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

	updateToolbar() {
		this.toolbar?.update();
	}

	/** Deaktiviert den Block, wenn `target` außerhalb liegt. */
	deactivateUnless(target: Node) {
		if (!this.containerEl.contains(target)) this.containerEl.removeClass("is-active");
	}

	private get bgStyle(): BgStyle {
		const style = this.fields.bgStyle;
		return style === "ruled" || style === "grid" || style === "blank" ? style : this.plugin.settings.bgStyle;
	}

	private teardown() {
		this.background?.destroy();
		this.background = null;
		this.pipeline?.destroy();
		this.surface?.destroy();
		this.toolbar?.destroy();
		this.pipeline = null;
		this.surface = null;
		this.toolbar = null;
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
			// Neu geladen (Sync) oder von einem anderen Block derselben Datei geändert.
			this.surface?.setDoc(this.entry.doc);
			this.toolbar?.update();
		}
	};

	private readonly onOp = (op: InkOp) => {
		const entry = this.entry;
		if (!entry) return;
		entry.history.push(op);
		this.commit();
	};

	private commit() {
		const entry = this.entry;
		if (!entry) return;
		this.plugin.store.touch(entry);
		this.plugin.store.changed(entry, this.onStoreEvent);
		this.toolbar?.update();
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
			busy: () => [...this.plugin.blocks].some((b) => b.entry === entry && b.pipeline?.active),
			beforeWrite: () => {
				for (const b of this.plugin.blocks) {
					if (b.entry !== entry) continue;
					if (b.containerEl.hasClass("is-active")) entry.reactivate = true;
					b.releaseFocus();
				}
			},
		};
	}

	private undo() {
		const entry = this.entry;
		const op = entry && entry.history.undo(entry.doc);
		if (op) this.afterHistory(op);
	}

	private redo() {
		const entry = this.entry;
		const op = entry && entry.history.redo(entry.doc);
		if (op) this.afterHistory(op);
	}

	private afterHistory(op: InkOp) {
		this.surface?.resize();
		this.surface?.redraw(opBounds(op));
		this.commit();
	}

	private readonly activate = () => {
		this.containerEl.addClass("is-active");
		this.surface?.el.focus({ preventScroll: true });
	};

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
		if (mod && key === "z" && !e.shiftKey) this.undo();
		else if (mod && ((key === "z" && e.shiftKey) || key === "y")) this.redo();
		else if (e.key === "Escape") {
			this.containerEl.removeClass("is-active");
			this.surface?.el.blur();
		} else handled = false;
		if (handled) {
			// Nicht an CodeMirror weiterreichen – sonst würde zusätzlich der Notiztext rückgängig gemacht.
			e.preventDefault();
			e.stopPropagation();
		}
	};

	private cycleBg() {
		const path = this.path;
		if (!path) return;
		const next = BG_CYCLE[(BG_CYCLE.indexOf(this.bgStyle) + 1) % BG_CYCLE.length];
		const hint = this.ctx.getSectionInfo(this.containerEl)?.lineStart;
		// Live Preview rendert den Block danach neu; Dokument und Undo bleiben im Store.
		this.fields.bgStyle = next;
		this.surface?.setBgStyle(next);
		this.toolbar?.update();
		this.releaseFocus();
		void writeBlockField(this.plugin.app, this.ctx.sourcePath, path, "bgStyle", next, hint);
	}

	private render() {
		const entry = this.entry;
		if (!entry) return;
		this.teardown();
		this.containerEl.empty();
		this.containerEl.removeClass("is-message");
		this.toolbar = new Toolbar(this.containerEl, this.plugin, {
			undo: () => this.undo(),
			redo: () => this.redo(),
			canUndo: () => !!this.entry?.history.canUndo,
			canRedo: () => !!this.entry?.history.canRedo,
			bgStyle: () => (this.entry?.doc.space === "nb" ? this.bgStyle : null),
			cycleBg: () => this.cycleBg(),
		});
		// Klick auf die Leiste aktiviert den Block ebenfalls (Capture: die Leiste stoppt die Propagation).
		this.toolbar.el.addEventListener("pointerdown", this.activate, { capture: true });
		this.surface = new Surface(this.containerEl, entry.doc, this.bgStyle);
		this.surface.el.dataset.path = entry.path;
		this.surface.el.tabIndex = -1;
		this.pipeline = new PointerPipeline(this.plugin, entry, this.surface, this.onOp, this.activate);
		this.renderCaption();
		this.setupBackground(entry);
		if (entry.reactivate) {
			entry.reactivate = false;
			this.activate();
		}
	}

	/** `bg:`-Link auflösen (relativ zur Notiz); `null` + Fehlermeldung, wenn die Datei fehlt. */
	private resolveBackground(): { file: TFile; page: number } | { error: string } | null {
		const link = parseBgLink(this.fields.bg);
		if (!link) return null;
		const file = this.plugin.app.metadataCache.getFirstLinkpathDest(link.linkpath, this.ctx.sourcePath);
		if (!file) return { error: `Hintergrund nicht gefunden: ${link.linkpath}` };
		if (!backgroundKind(file)) return { error: `Kein PDF/Bild: ${file.path}` };
		return { file, page: link.page ?? 1 };
	}

	private setupBackground(entry: InkEntry) {
		const surface = this.surface;
		const bg = this.resolveBackground();
		if (!bg || !surface) return;
		if ("error" in bg) {
			surface.showOverlay(bg.error);
			return;
		}
		// Leeres Heft mit nachträglich eingetragenem bg: → in ein Arbeitsblatt umwandeln.
		if (entry.doc.space === "nb" && entry.doc.strokes.length === 0) {
			void this.convertToPage(entry, bg.file, bg.page);
			return;
		}
		this.background = new PageBackground(this.plugin.app, bg.file, bg.page, surface.bgEl, (msg) => surface.showOverlay(msg));
		surface.onLayout = (w, dpr) => this.background?.update(w, dpr);
		surface.layout(true);
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
			this.surface?.showOverlay(`Hintergrund: ${(e as Error).message}`);
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
