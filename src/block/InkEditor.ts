import type { TFile } from "obsidian";
import { PointerPipeline } from "../input/PointerPipeline";
import type InkBlocksPlugin from "../main";
import { opBounds, type InkOp } from "../model/ops";
import { PageBackground } from "../render/background";
import { Surface } from "../render/Surface";
import type { BgStyle } from "../settings";
import type { InkEntry } from "../store/InkStore";
import { Toolbar } from "../ui/Toolbar";

export type ResolvedBackground = { file: TFile; page: number } | { error: string } | null;

export interface InkEditorHost {
	plugin: InkBlocksPlugin;
	entry: InkEntry;
	bgStyle(): BgStyle;
	cycleBg(): void;
	background: ResolvedBackground;
	/** Nach jeder Änderung (Strich, Radieren, Undo/Redo): speichern, andere Ansichten, Texterkennung. */
	commit(): void;
	activate(): void;
	/** Ausklappen bzw. (in der ausgeklappten Ansicht) wieder einklappen. */
	toggleExpand?(): void;
	expanded?: boolean;
}

/**
 * Werkzeugleiste + Zeichenfläche + Eingabe + Hintergrund für eine .ink-Datei. Wird vom Block in der
 * Notiz und von der ausgeklappten Ansicht verwendet; beide arbeiten auf demselben Store-Eintrag.
 */
export class InkEditor {
	readonly toolbar: Toolbar;
	readonly surface: Surface;
	readonly pipeline: PointerPipeline;
	private background: PageBackground | null = null;

	constructor(
		container: HTMLElement,
		private readonly host: InkEditorHost,
	) {
		const { plugin, entry } = host;
		this.toolbar = new Toolbar(container, plugin, {
			undo: () => this.undo(),
			redo: () => this.redo(),
			canUndo: () => entry.history.canUndo,
			canRedo: () => entry.history.canRedo,
			bgStyle: () => (entry.doc.space === "nb" ? host.bgStyle() : null),
			cycleBg: () => host.cycleBg(),
			toggleExpand: host.toggleExpand ? () => host.toggleExpand?.() : undefined,
			expanded: !!host.expanded,
		});
		// Klick auf die Leiste aktiviert die Ansicht ebenfalls (Capture: die Leiste stoppt die Propagation).
		this.toolbar.el.addEventListener("pointerdown", () => host.activate(), { capture: true });
		this.surface = new Surface(container, entry.doc, host.bgStyle());
		this.surface.el.dataset.path = entry.path;
		this.surface.el.tabIndex = -1;
		this.pipeline = new PointerPipeline(plugin, entry, this.surface, this.onOp, () => host.activate());
		plugin.editors.add(this);
		this.setupBackground();
	}

	get entry(): InkEntry {
		return this.host.entry;
	}

	get busy(): boolean {
		return this.pipeline.active;
	}

	destroy() {
		this.host.plugin.editors.delete(this);
		this.background?.destroy();
		this.pipeline.destroy();
		this.surface.destroy();
		this.toolbar.destroy();
	}

	/** Dokument neu geladen (Sync) oder in einer anderen Ansicht geändert. */
	setDoc() {
		this.surface.setDoc(this.host.entry.doc);
		this.toolbar.update();
	}

	refresh() {
		this.surface.setBgStyle(this.host.bgStyle());
		this.surface.redrawAll();
		this.toolbar.update();
	}

	undo() {
		const { entry } = this.host;
		const op = entry.history.undo(entry.doc);
		if (op) this.afterHistory(op);
	}

	redo() {
		const { entry } = this.host;
		const op = entry.history.redo(entry.doc);
		if (op) this.afterHistory(op);
	}

	private afterHistory(op: InkOp) {
		this.surface.resize();
		this.surface.redraw(opBounds(op));
		this.host.commit();
		this.toolbar.update();
	}

	private readonly onOp = (op: InkOp) => {
		this.host.entry.history.push(op);
		this.host.commit();
		this.toolbar.update();
	};

	private setupBackground() {
		const bg = this.host.background;
		if (!bg) return;
		if ("error" in bg) {
			this.surface.showOverlay(bg.error);
			return;
		}
		const surface = this.surface;
		this.background = new PageBackground(this.host.plugin.app, bg.file, bg.page, surface.bgEl, (msg) => surface.showOverlay(msg));
		surface.onLayout = (w, dpr) => this.background?.update(w, dpr);
		surface.layout(true);
	}
}
