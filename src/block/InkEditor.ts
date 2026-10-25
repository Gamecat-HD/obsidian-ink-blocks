import type { TFile } from "obsidian";
import { PointerPipeline } from "../input/PointerPipeline";
import { Selection } from "../input/Selection";
import type InkBlocksPlugin from "../main";
import { opBounds, type InkOp } from "../model/ops";
import { PageBackground } from "../render/background";
import { Surface } from "../render/Surface";
import type { Pattern, PatternChange } from "../model/pattern";
import type { InkEntry } from "../store/InkStore";
import { Toolbar } from "../ui/Toolbar";

export type ResolvedBackground = { file: TFile; page: number } | { error: string } | null;

export interface InkEditorHost {
	plugin: InkBlocksPlugin;
	entry: InkEntry;
	pattern(): Pattern;
	setPattern(change: PatternChange): void;
	background: ResolvedBackground;
	/** Nach jeder Änderung (Strich, Radieren, Undo/Redo): speichern, andere Ansichten, Texterkennung. */
	commit(): void;
	activate(): void;
	/** Ausklappen bzw. (in der ausgeklappten Ansicht) wieder einklappen. */
	toggleExpand?(): void;
	expanded?: boolean;
	/** Lasso → „Als Text einfügen“: Absatz unter den Block in der Notiz schreiben. */
	insertText?(text: string): Promise<boolean>;
}

/**
 * Werkzeugleiste + Zeichenfläche + Eingabe + Hintergrund für eine .ink-Datei. Wird vom Block in der
 * Notiz und von der ausgeklappten Ansicht verwendet; beide arbeiten auf demselben Store-Eintrag.
 */
export class InkEditor {
	readonly toolbar: Toolbar;
	readonly surface: Surface;
	readonly pipeline: PointerPipeline;
	readonly selection: Selection;
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
			pattern: () => (entry.doc.space === "nb" ? host.pattern() : null),
			setPattern: (change) => host.setPattern(change),
			previewGap: (gap) => this.surface.setPattern(gap === null ? host.pattern() : { ...host.pattern(), gap, custom: true }),
			toggleExpand: host.toggleExpand ? () => host.toggleExpand?.() : undefined,
			expanded: !!host.expanded,
		});
		// Klick auf die Leiste aktiviert die Ansicht ebenfalls (Capture: die Leiste stoppt die Propagation).
		this.toolbar.el.addEventListener("pointerdown", () => host.activate(), { capture: true });
		this.surface = new Surface(container, entry.doc, host.pattern());
		this.surface.el.dataset.path = entry.path;
		this.surface.el.tabIndex = -1;
		this.selection = new Selection({
			plugin,
			entry,
			surface: this.surface,
			onOp: this.onOp,
			insertText: host.insertText ? (text) => host.insertText?.(text) ?? Promise.resolve(false) : undefined,
		});
		this.pipeline = new PointerPipeline(plugin, entry, this.surface, this.selection, this.onOp, () => host.activate());
		plugin.editors.add(this);
		this.setupBackground();
	}

	get entry(): InkEntry {
		return this.host.entry;
	}

	/** Gehört zur ausgeklappten Ansicht (nicht zu einem Block in der Notiz). */
	get expanded(): boolean {
		return !!this.host.expanded;
	}

	get busy(): boolean {
		return this.pipeline.active;
	}

	destroy() {
		this.host.plugin.editors.delete(this);
		this.background?.destroy();
		this.pipeline.destroy();
		this.selection.destroy();
		this.surface.destroy();
		this.toolbar.destroy();
	}

	/** Dokument neu geladen (Sync) oder in einer anderen Ansicht geändert. */
	setDoc() {
		this.surface.setDoc(this.host.entry.doc);
		this.selection.validate();
		this.toolbar.update();
	}

	/** Werkzeug gewechselt (in irgendeiner Leiste): Auswahl gilt nur fürs Lasso. */
	toolsChanged() {
		if (this.host.plugin.settings.tools.tool !== "lasso") this.selection.clear();
		this.toolbar.update();
	}

	/**
	 * Tastenkürzel der Auswahl (Block bzw. ausgeklappte Ansicht). `true` = erledigt, nicht an den Editor
	 * weiterreichen.
	 */
	handleKey(e: KeyboardEvent): boolean {
		const sel = this.selection;
		const mod = e.ctrlKey || e.metaKey;
		const key = e.key.toLowerCase();
		if (mod && key === "v") return sel.pasteClipboard();
		if (mod && key === "a") {
			sel.selectAll();
			return true;
		}
		if (!sel.active) return false;
		const step = e.shiftKey ? 20 : 2;
		const arrows: Record<string, [number, number]> = { arrowleft: [-step, 0], arrowright: [step, 0], arrowup: [0, -step], arrowdown: [0, step] };
		if (key === "delete" || key === "backspace") sel.delete();
		else if (mod && key === "c") sel.copy();
		else if (mod && key === "x") sel.cut();
		else if (mod && key === "d") sel.duplicate();
		else if (key === "escape") sel.clear();
		else if (!mod && arrows[key]) sel.nudge(...arrows[key]);
		else return false;
		return true;
	}

	refresh() {
		this.surface.setPattern(this.host.pattern());
		this.surface.redrawAll();
		this.toolbar.update();
	}

	undo() {
		this.selection.clear();
		const { entry } = this.host;
		const op = entry.history.undo(entry.doc);
		if (op) this.afterHistory(op);
	}

	redo() {
		this.selection.clear();
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
