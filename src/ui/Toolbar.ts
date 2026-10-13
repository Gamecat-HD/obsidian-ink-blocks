import { Menu, setIcon, setTooltip } from "obsidian";
import type InkBlocksPlugin from "../main";
import { GAP_PRESETS, type BgStyle, type Pattern, type PatternChange } from "../model/pattern";
import { HL_COLORS, PALETTE, PEN_COLORS } from "../render/strokes";
import type { ToolId, WidthSlot } from "../settings";

export interface ToolbarActions {
	undo(): void;
	redo(): void;
	canUndo(): boolean;
	canRedo(): boolean;
	/** `null` = kein Hintergrund-Menü (Arbeitsblatt – dort ist „Tinte“ schwarz). */
	pattern(): Pattern | null;
	setPattern(change: PatternChange): void;
	/** Ausklappen/Einklappen (fehlt → kein Button). */
	toggleExpand?: () => void;
	/** Leiste gehört zur ausgeklappten Ansicht. */
	expanded?: boolean;
}

const TOOLS: { id: ToolId; icon: string; label: string }[] = [
	{ id: "pen", icon: "pencil", label: "Stift" },
	{ id: "hl", icon: "highlighter", label: "Textmarker" },
	{ id: "eraser", icon: "eraser", label: "Radierer" },
];

const BG_ICON: Record<BgStyle, { icon: string; label: string }> = {
	ruled: { icon: "align-justify", label: "Liniert" },
	grid: { icon: "grid", label: "Kariert" },
	blank: { icon: "square", label: "Leer" },
};

const WIDTHS: { slot: WidthSlot; label: string; cls: string }[] = [
	{ slot: 0, label: "Fein", cls: "is-fine" },
	{ slot: 1, label: "Mittel", cls: "is-medium" },
	{ slot: 2, label: "Breit", cls: "is-bold" },
];

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
		for (const w of WIDTHS) {
			const btn = widths.createEl("button", { cls: "ink-tb-width clickable-icon" });
			btn.createSpan({ cls: `ink-tb-dot ${w.cls}` });
			setTooltip(btn, w.label);
			btn.addEventListener("click", () => this.setWidth(w.slot));
			this.widths.push(btn);
		}

		const edit = this.group();
		this.undoBtn = this.button(edit, "undo-2", "Rückgängig (Strg+Z)", () => actions.undo());
		this.redoBtn = this.button(edit, "redo-2", "Wiederholen (Strg+Umschalt+Z)", () => actions.redo());
		this.bgBtn = this.button(edit, "align-justify", "Hintergrund", () => this.showPatternMenu());
		if (actions.toggleExpand) {
			const label = actions.expanded ? "Einklappen (Esc)" : "Ausklappen – große Schreibfläche";
			const btn = this.button(edit, actions.expanded ? "minimize-2" : "maximize-2", label, () => actions.toggleExpand?.());
			btn.addClass("ink-tb-expand");
		}

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
		const pattern = this.actions.pattern();
		const ink = pattern === null ? "#111" : "var(--text-normal)";
		this.swatches.forEach((sw, i) => {
			const index = palette[i];
			sw.style.setProperty("--swatch", PALETTE[index] === "ink" ? ink : PALETTE[index]);
			sw.toggleClass("is-active", index === current);
			sw.dataset.color = String(index);
			setTooltip(sw, `Farbe ${i + 1}`);
		});
		const width = hl ? t.hlWidth : t.penWidth;
		this.widths.forEach((btn, i) => btn.toggleClass("is-active", i === width));
		this.bar.toggleClass("is-eraser", t.tool === "eraser");

		this.undoBtn.toggleClass("is-disabled", !this.actions.canUndo());
		this.redoBtn.toggleClass("is-disabled", !this.actions.canRedo());
		this.bgBtn.toggle(pattern !== null);
		if (pattern) {
			setIcon(this.bgBtn, BG_ICON[pattern.style].icon);
			setTooltip(this.bgBtn, `Hintergrund: ${BG_ICON[pattern.style].label.toLowerCase()}`);
			this.bgBtn.dataset.bg = pattern.style;
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

	/** Hintergrund-Menü: Stil und Linienabstand/Kästchengröße dieser Fläche (touch-tauglich). */
	private showPatternMenu() {
		const p = this.actions.pattern();
		if (!p) return;
		const menu = new Menu();
		for (const style of ["ruled", "grid", "blank"] as const) {
			menu.addItem((item) =>
				item
					.setTitle(BG_ICON[style].label)
					.setIcon(BG_ICON[style].icon)
					.setChecked(p.style === style)
					.onClick(() => this.actions.setPattern({ style })),
			);
		}
		if (p.style !== "blank") {
			menu.addSeparator();
			const what = p.style === "grid" ? "Kästchen" : "Abstand";
			for (const preset of GAP_PRESETS[p.style]) {
				menu.addItem((item) =>
					item
						.setTitle(`${what}: ${preset.label}`)
						.setChecked(p.custom && p.gap === preset.value)
						.onClick(() => this.actions.setPattern({ gap: preset.value })),
				);
			}
			menu.addItem((item) =>
				item
					.setTitle(`${what}: Standard`)
					.setChecked(!p.custom)
					.onClick(() => this.actions.setPattern({ gap: null })),
			);
		}
		const r = this.bgBtn.getBoundingClientRect();
		menu.showAtPosition({ x: r.left, y: r.bottom + 4 });
	}

	private setWidth(w: WidthSlot) {
		const t = this.plugin.settings.tools;
		if (t.tool === "hl") t.hlWidth = w;
		else {
			t.penWidth = w;
			if (t.tool === "eraser") t.tool = "pen";
		}
		this.plugin.toolsChanged();
	}
}
