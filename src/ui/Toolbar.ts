import { Menu, setIcon, setTooltip } from "obsidian";
import type InkBlocksPlugin from "../main";
import { defaultGap, GAP_PRESETS, type BgStyle, type Pattern, type PatternChange } from "../model/pattern";
import { HL_COLORS, PALETTE, PEN_COLORS, TAPE_COLORS } from "../render/strokes";
import { MAX_CUSTOM_COLORS, type ColorKind, type ToolId, type WidthSlot } from "../settings";
import { GapPopover } from "./GapPopover";

export interface ToolbarActions {
	undo(): void;
	redo(): void;
	canUndo(): boolean;
	canRedo(): boolean;
	/** `null` = kein Hintergrund-Menü (Arbeitsblatt – dort ist „Tinte“ schwarz). */
	pattern(): Pattern | null;
	setPattern(change: PatternChange): void;
	/** Abstand nur anzeigen, nicht speichern (Schieberegler); `null` = wieder wie im Block. */
	previewGap(gap: number | null): void;
	/** Ausklappen/Einklappen (fehlt → kein Button). */
	toggleExpand?: () => void;
	/** Leiste gehört zur ausgeklappten Ansicht. */
	expanded?: boolean;
	/** Abdeckbänder im Dokument: keine, mindestens eins zugedeckt, alle aufgedeckt. */
	tapeState(): "none" | "covered" | "revealed";
	toggleAllTape(): void;
	/** Block samt Handschrift löschen (fehlt → kein Button, z. B. in der ausgeklappten Ansicht). */
	deleteBlock?: () => void;
}

const TOOLS: { id: ToolId; icon: string; label: string }[] = [
	{ id: "pen", icon: "pencil", label: "Stift" },
	{ id: "hl", icon: "highlighter", label: "Textmarker" },
	{ id: "tape", icon: "bandage", label: "Abdeckband: Antworten abdecken, Tippen deckt auf" },
	{ id: "eraser", icon: "eraser", label: "Radierer (nochmal tippen: Optionen)" },
	{ id: "lasso", icon: "lasso", label: "Lasso: auswählen, verschieben, kopieren" },
];

const BG_ICON: Record<BgStyle, { icon: string; label: string }> = {
	ruled: { icon: "align-justify", label: "Liniert" },
	grid: { icon: "grid", label: "Kariert" },
	dots: { icon: "grip", label: "Punkteraster" },
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
	private readonly customEl: HTMLElement;
	private readonly addColorBtn: HTMLElement;
	private readonly colorInput: HTMLInputElement;
	private readonly widths: HTMLElement[] = [];
	private readonly undoBtn: HTMLElement;
	private readonly redoBtn: HTMLElement;
	private readonly bgBtn: HTMLElement;
	private readonly straightBtn: HTMLElement;
	private readonly tapeBtn: HTMLElement;

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

		// Lineal: nur beim Textmarker sichtbar.
		this.straightBtn = this.button(tools, "ruler", "Gerade Linien (Lineal)", () => this.toggleStraight());
		this.straightBtn.addClass("ink-tb-straight");

		const colors = this.group();
		for (let i = 0; i < Math.max(PEN_COLORS.length, HL_COLORS.length); i++) {
			const sw = colors.createEl("button", { cls: "ink-tb-swatch clickable-icon" });
			sw.addEventListener("click", () => this.setColor(i));
			this.swatches.push(sw);
		}
		// Eigene Farben (je Werkzeug) und „+“ mit dem Farbwähler des Systems.
		this.customEl = colors.createDiv({ cls: "ink-tb-custom" });
		this.addColorBtn = this.button(colors, "plus", "Eigene Farbe …", () => this.pickColor());
		this.addColorBtn.addClass("ink-tb-add-color");
		this.colorInput = colors.createEl("input", { type: "color", cls: "ink-tb-color-input" });
		this.colorInput.addEventListener("change", () => this.addCustomColor(this.colorInput.value));

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
		this.bgBtn = this.button(edit, "align-justify", "Hintergrund und Zeilenabstand", () => this.showPatternMenu());
		this.tapeBtn = this.button(edit, "eye", "Alle Abdeckbänder aufdecken", () => actions.toggleAllTape());
		this.tapeBtn.addClass("ink-tb-tape-toggle");
		if (actions.toggleExpand) {
			const label = actions.expanded ? "Einklappen (Esc)" : "Ausklappen – große Schreibfläche";
			const btn = this.button(edit, actions.expanded ? "minimize-2" : "maximize-2", label, () => actions.toggleExpand?.());
			btn.addClass("ink-tb-expand");
		}
		if (actions.deleteBlock) {
			const label = actions.pattern() === null ? "Arbeitsblatt-Seite löschen" : "Schreibfläche löschen";
			const btn = this.button(edit, "trash-2", label, () => actions.deleteBlock?.());
			btn.addClass("ink-tb-delete");
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
		const tape = t.tool === "tape";
		const palette = hl ? HL_COLORS : tape ? TAPE_COLORS : PEN_COLORS;
		const current = hl ? t.hlColor : tape ? t.tapeColor : t.penColor;
		const pattern = this.actions.pattern();
		const ink = pattern === null ? "#111" : "var(--text-normal)";
		this.straightBtn.toggle(hl);
		this.straightBtn.toggleClass("is-active", this.plugin.settings.hlStraight);
		this.swatches.forEach((sw, i) => {
			const index = palette[i];
			sw.toggle(index !== undefined);
			if (index === undefined) return;
			sw.style.setProperty("--swatch", PALETTE[index] === "ink" ? ink : PALETTE[index]);
			sw.toggleClass("is-active", index === current);
			sw.dataset.color = String(index);
			setTooltip(sw, `Farbe ${i + 1}`);
		});
		const kind = this.colorKind();
		this.customEl.empty();
		this.addColorBtn.toggle(kind !== null);
		for (const color of kind ? this.plugin.settings.customColors[kind] : []) {
			const sw = this.customEl.createEl("button", { cls: "ink-tb-swatch clickable-icon is-custom" });
			sw.style.setProperty("--swatch", color);
			sw.dataset.color = color;
			sw.toggleClass("is-active", color === current);
			setTooltip(sw, `${color} (Rechtsklick: entfernen)`);
			sw.addEventListener("click", () => this.setColor(color));
			sw.addEventListener("contextmenu", (e) => {
				e.preventDefault();
				e.stopPropagation();
				this.removeCustomColor(color, e);
			});
		}
		const width = hl ? t.hlWidth : tape ? t.tapeWidth : t.tool === "eraser" ? t.eraserWidth : t.penWidth;
		this.widths.forEach((btn, i) => btn.toggleClass("is-active", i === width));
		this.bar.toggleClass("is-eraser", t.tool === "eraser");
		const eraser = this.toolButtons.get("eraser");
		eraser?.toggleClass("is-precise", this.plugin.settings.eraserMode === "precise");
		eraser?.toggleClass("is-hl-only", this.plugin.settings.eraseHlOnly);
		this.bar.toggleClass("is-lasso", t.tool === "lasso");

		this.undoBtn.toggleClass("is-disabled", !this.actions.canUndo());
		this.redoBtn.toggleClass("is-disabled", !this.actions.canRedo());
		const tapeState = this.actions.tapeState();
		this.tapeBtn.toggle(tapeState !== "none");
		const revealed = tapeState === "revealed";
		setIcon(this.tapeBtn, revealed ? "eye-off" : "eye");
		setTooltip(this.tapeBtn, revealed ? "Alle Abdeckbänder wieder zudecken" : "Alle Abdeckbänder aufdecken");
		this.tapeBtn.toggleClass("is-active", revealed);
		this.bgBtn.toggle(pattern !== null);
		if (pattern) {
			setIcon(this.bgBtn, BG_ICON[pattern.style].icon);
			const what = pattern.style === "ruled" ? "Zeilenabstand" : pattern.style === "dots" ? "Punktabstand" : "Kästchengröße";
			setTooltip(this.bgBtn, `Hintergrund: ${BG_ICON[pattern.style].label.toLowerCase()}${pattern.style === "blank" ? "" : ` · ${what} ${pattern.gap}`}`);
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
		if (tool === "eraser" && this.plugin.settings.tools.tool === "eraser") return this.showEraserMenu();
		this.plugin.settings.tools.tool = tool;
		this.plugin.toolsChanged();
	}

	/** Radierer-Optionen: ganze Striche oder präzise, nur Textmarker. */
	private showEraserMenu() {
		const settings = this.plugin.settings;
		const set = (change: () => void) => () => {
			change();
			this.plugin.toolsChanged();
		};
		const menu = new Menu();
		menu.addItem((i) =>
			i.setTitle("Ganze Striche").setIcon("eraser").setChecked(settings.eraserMode === "stroke").onClick(set(() => (settings.eraserMode = "stroke"))),
		);
		menu.addItem((i) =>
			i.setTitle("Präzise (nur berührte Stellen)").setIcon("scissors-line-dashed").setChecked(settings.eraserMode === "precise").onClick(set(() => (settings.eraserMode = "precise"))),
		);
		menu.addSeparator();
		menu.addItem((i) =>
			i.setTitle("Nur Textmarker radieren").setIcon("highlighter").setChecked(settings.eraseHlOnly).onClick(set(() => (settings.eraseHlOnly = !settings.eraseHlOnly))),
		);
		const btn = this.toolButtons.get("eraser");
		const r = btn?.getBoundingClientRect();
		if (r) menu.showAtPosition({ x: r.left, y: r.bottom + 4 });
	}

	private toggleStraight() {
		this.plugin.settings.hlStraight = !this.plugin.settings.hlStraight;
		this.plugin.toolsChanged();
	}

	/** Für welche Werkzeug-Palette die Farbknöpfe gerade stehen (Radierer/Lasso: Stift). */
	private colorKind(): ColorKind | null {
		const tool = this.plugin.settings.tools.tool;
		return tool === "hl" || tool === "tape" ? tool : "pen";
	}

	private pickColor() {
		const t = this.plugin.settings.tools;
		const current = t.tool === "hl" ? t.hlColor : t.tool === "tape" ? t.tapeColor : t.penColor;
		this.colorInput.value = typeof current === "string" ? current : "#7048e8";
		this.colorInput.click();
	}

	private addCustomColor(color: string) {
		const kind = this.colorKind();
		if (!kind || !/^#[0-9a-f]{6}$/i.test(color)) return;
		const list = this.plugin.settings.customColors[kind];
		this.plugin.settings.customColors[kind] = [color, ...list.filter((c) => c !== color)].slice(0, MAX_CUSTOM_COLORS);
		this.setColor(color);
	}

	private removeCustomColor(color: string, e: MouseEvent) {
		const kind = this.colorKind();
		if (!kind) return;
		const menu = new Menu();
		menu.addItem((i) =>
			i.setTitle("Farbe entfernen").setIcon("trash-2").onClick(() => {
				const settings = this.plugin.settings;
				settings.customColors[kind] = settings.customColors[kind].filter((c) => c !== color);
				const t = settings.tools;
				if (kind === "pen" && t.penColor === color) t.penColor = PEN_COLORS[0];
				if (kind === "hl" && t.hlColor === color) t.hlColor = HL_COLORS[0];
				if (kind === "tape" && t.tapeColor === color) t.tapeColor = TAPE_COLORS[0];
				this.plugin.toolsChanged();
			}),
		);
		menu.showAtMouseEvent(e);
	}

	/** Paletten-Slot (Zahl = Position in der Palette des Werkzeugs) oder eigene Farbe (`#rrggbb`). */
	private setColor(slotOrColor: number | string) {
		const t = this.plugin.settings.tools;
		const pick = (palette: number[]) => (typeof slotOrColor === "string" ? slotOrColor : palette[slotOrColor]);
		if (t.tool === "hl") t.hlColor = pick(HL_COLORS);
		else if (t.tool === "tape") t.tapeColor = pick(TAPE_COLORS);
		else {
			t.penColor = pick(PEN_COLORS);
			if (t.tool === "eraser" || t.tool === "lasso") t.tool = "pen";
		}
		this.plugin.toolsChanged();
	}

	/** Hintergrund-Menü: Stil und Linienabstand/Kästchengröße dieser Fläche (touch-tauglich). */
	private showPatternMenu() {
		const p = this.actions.pattern();
		if (!p) return;
		const menu = new Menu();
		for (const style of ["ruled", "grid", "dots", "blank"] as const) {
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
			menu.addItem((item) =>
				item
					.setTitle(`${p.style === "ruled" ? "Zeilenabstand" : p.style === "dots" ? "Punktabstand" : "Kästchengröße"} einstellen … (${p.gap})`)
					.setIcon("sliders-horizontal")
					.onClick(() => this.showGapPopover()),
			);
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

	/** Schieberegler für den Abstand dieser Fläche (Vorschau live, gespeichert beim Schließen). */
	private showGapPopover() {
		const p = this.actions.pattern();
		if (!p || p.style === "blank") return;
		new GapPopover(this.bgBtn, {
			pattern: p,
			defaultGap: defaultGap(p.style, this.plugin.settings),
			preview: (gap) => this.actions.previewGap(gap),
			commit: (gap) => this.actions.setPattern({ gap }),
		});
	}

	private setWidth(w: WidthSlot) {
		const t = this.plugin.settings.tools;
		if (t.tool === "hl") t.hlWidth = w;
		else if (t.tool === "tape") t.tapeWidth = w;
		else if (t.tool === "eraser") t.eraserWidth = w;
		else {
			t.penWidth = w;
			if (t.tool === "lasso") t.tool = "pen";
		}
		this.plugin.toolsChanged();
	}
}
