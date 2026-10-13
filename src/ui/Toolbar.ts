import { setIcon, setTooltip } from "obsidian";
import type InkBlocksPlugin from "../main";
import { HL_COLORS, PALETTE, PEN_COLORS } from "../render/strokes";
import type { BgStyle, ToolId } from "../settings";

export interface ToolbarActions {
	undo(): void;
	redo(): void;
	canUndo(): boolean;
	canRedo(): boolean;
	/** `null` = kein Hintergrund-Umschalter (z. B. Arbeitsblatt). */
	bgStyle(): BgStyle | null;
	cycleBg(): void;
}

const TOOLS: { id: ToolId; icon: string; label: string }[] = [
	{ id: "pen", icon: "pencil", label: "Stift" },
	{ id: "hl", icon: "highlighter", label: "Textmarker" },
	{ id: "eraser", icon: "eraser", label: "Radierer" },
];

const BG_ICON: Record<BgStyle, { icon: string; label: string }> = {
	ruled: { icon: "align-justify", label: "Hintergrund: liniert" },
	grid: { icon: "grid-3x3", label: "Hintergrund: kariert" },
	blank: { icon: "square", label: "Hintergrund: leer" },
};

/**
 * Schwebende Mini-Werkzeugleiste am Block. Der Werkzeugzustand ist global (Settings),
 * Undo/Redo und Hintergrund gehören zum Block.
 */
export class Toolbar {
	readonly el: HTMLElement;
	private readonly bar: HTMLElement;
	private readonly toolButtons = new Map<ToolId, HTMLElement>();
	private readonly swatches: HTMLElement[] = [];
	private readonly widths: HTMLElement[] = [];
	private readonly undoBtn: HTMLElement;
	private readonly redoBtn: HTMLElement;
	private readonly bgBtn: HTMLElement;

	constructor(
		parent: HTMLElement,
		private readonly plugin: InkBlocksPlugin,
		private readonly actions: ToolbarActions,
	) {
		// Sticky-Hülle mit Höhe 0: die Leiste bleibt beim Scrollen langer Blöcke sichtbar.
		this.el = parent.createDiv({ cls: "ink-toolbar-anchor" });
		this.bar = this.el.createDiv({ cls: "ink-toolbar" });
		// Klicks auf die Leiste sollen weder zeichnen noch den Editor-Cursor setzen. Buttons nehmen keinen
		// Fokus: läge die DOM-Auswahl im Widget, würde CodeMirror sie beim nächsten Re-Render in den Block holen.
		for (const type of ["pointerdown", "mousedown", "click", "touchstart"]) {
			this.bar.addEventListener(type, (e) => {
				e.stopPropagation();
				if (type === "mousedown") e.preventDefault();
			});
		}

		const tools = this.group();
		for (const t of TOOLS) {
			const btn = this.button(tools, t.icon, t.label, () => this.setTool(t.id));
			btn.dataset.tool = t.id;
			this.toolButtons.set(t.id, btn);
		}

		const colors = this.group();
		for (let i = 0; i < 3; i++) {
			const sw = colors.createEl("button", { cls: "ink-tb-swatch clickable-icon" });
			sw.addEventListener("click", () => this.setColor(i));
			this.swatches.push(sw);
		}

		const widths = this.group();
		for (const w of [0, 1] as const) {
			const btn = widths.createEl("button", { cls: "ink-tb-width clickable-icon" });
			btn.createSpan({ cls: `ink-tb-dot is-${w ? "bold" : "fine"}` });
			setTooltip(btn, w ? "Breit" : "Fein");
			btn.addEventListener("click", () => this.setWidth(w));
			this.widths.push(btn);
		}

		const edit = this.group();
		this.undoBtn = this.button(edit, "undo-2", "Rückgängig (Strg+Z)", () => actions.undo());
		this.redoBtn = this.button(edit, "redo-2", "Wiederholen (Strg+Umschalt+Z)", () => actions.redo());
		this.bgBtn = this.button(edit, "align-justify", "Hintergrund", () => actions.cycleBg());

		this.update();
	}

	destroy() {
		this.el.remove();
	}

	/** Zustand aus den Settings und dem Block übernehmen. */
	update() {
		const t = this.plugin.settings.tools;
		for (const [id, btn] of this.toolButtons) btn.toggleClass("is-active", id === t.tool);

		const hl = t.tool === "hl";
		const palette = hl ? HL_COLORS : PEN_COLORS;
		const current = hl ? t.hlColor : t.penColor;
		this.swatches.forEach((sw, i) => {
			const index = palette[i];
			sw.style.setProperty("--swatch", PALETTE[index] === "ink" ? "var(--text-normal)" : PALETTE[index]);
			sw.toggleClass("is-active", index === current);
			sw.dataset.color = String(index);
			setTooltip(sw, `Farbe ${i + 1}`);
		});
		const width = hl ? t.hlWidth : t.penWidth;
		this.widths.forEach((btn, i) => btn.toggleClass("is-active", i === width));
		this.bar.toggleClass("is-eraser", t.tool === "eraser");

		this.undoBtn.toggleClass("is-disabled", !this.actions.canUndo());
		this.redoBtn.toggleClass("is-disabled", !this.actions.canRedo());
		const bg = this.actions.bgStyle();
		this.bgBtn.toggle(bg !== null);
		if (bg) {
			setIcon(this.bgBtn, BG_ICON[bg].icon);
			setTooltip(this.bgBtn, BG_ICON[bg].label);
			this.bgBtn.dataset.bg = bg;
		}
	}

	private group(): HTMLElement {
		return this.bar.createDiv({ cls: "ink-tb-group" });
	}

	private button(parent: HTMLElement, icon: string, label: string, onClick: () => void): HTMLElement {
		const btn = parent.createEl("button", { cls: "ink-tb-button clickable-icon" });
		setIcon(btn, icon);
		setTooltip(btn, label);
		btn.setAttr("aria-label", label);
		btn.addEventListener("click", onClick);
		return btn;
	}

	private setTool(tool: ToolId) {
		this.plugin.settings.tools.tool = tool;
		this.plugin.toolsChanged();
	}

	private setColor(i: number) {
		const t = this.plugin.settings.tools;
		if (t.tool === "hl") t.hlColor = HL_COLORS[i];
		else {
			t.penColor = PEN_COLORS[i];
			if (t.tool === "eraser") t.tool = "pen";
		}
		this.plugin.toolsChanged();
	}

	private setWidth(w: 0 | 1) {
		const t = this.plugin.settings.tools;
		if (t.tool === "hl") t.hlWidth = w;
		else {
			t.penWidth = w;
			if (t.tool === "eraser") t.tool = "pen";
		}
		this.plugin.toolsChanged();
	}
}
