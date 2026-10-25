import type { BgStyle, Pattern } from "../model/pattern";
import { LIMITS } from "../settingsData";

export interface GapPopoverOptions {
	pattern: Pattern;
	/** Standardwert aus den Einstellungen (für „Standard“). */
	defaultGap: number;
	/** Vorschau auf der Fläche, ohne den Block zu schreiben (`null` = ursprünglicher Zustand). */
	preview(gap: number | null): void;
	/** Endgültig übernehmen: Zahl = eigener Abstand, `null` = Standard aus den Einstellungen. */
	commit(gap: number | null): void;
}

/**
 * Zeilenabstand bzw. Kästchengröße einer Fläche mit Schieberegler einstellen. Schwebt unter dem
 * Leisten-Knopf (kein Dialog mit Abdunklung), damit die Fläche beim Ziehen sichtbar bleibt.
 * Übernommen wird mit „Fertig“, Enter oder Klick daneben; Esc verwirft.
 */
export class GapPopover {
	private static open: GapPopover | null = null;
	private readonly el: HTMLElement;
	private value: number;
	private custom: boolean;

	constructor(anchor: HTMLElement, private readonly opts: GapPopoverOptions) {
		GapPopover.open?.close(true);
		GapPopover.open = this;
		const { pattern } = opts;
		const grid = pattern.style === "grid";
		const [min, max] = range(pattern.style);
		this.value = pattern.gap;
		this.custom = pattern.custom;

		this.el = document.body.createDiv({ cls: "ink-gap-popover" });
		this.el.createDiv({ cls: "ink-gap-title", text: grid ? "Kästchengröße" : pattern.style === "dots" ? "Punktabstand" : "Zeilenabstand" });
		const row = this.el.createDiv({ cls: "ink-gap-row" });
		const minus = row.createEl("button", { cls: "ink-gap-step", text: "−", attr: { "aria-label": "Kleiner" } });
		const slider = row.createEl("input", { cls: "ink-gap-slider", type: "range" });
		slider.min = String(min);
		slider.max = String(max);
		slider.step = "1";
		slider.value = String(this.value);
		const plus = row.createEl("button", { cls: "ink-gap-step", text: "+", attr: { "aria-label": "Größer" } });
		const label = this.el.createDiv({ cls: "ink-gap-value" });

		const actions = this.el.createDiv({ cls: "ink-gap-actions" });
		const reset = actions.createEl("button", { text: `Standard (${opts.defaultGap})` });
		const done = actions.createEl("button", { cls: "mod-cta", text: "Fertig" });

		const set = (v: number, custom = true) => {
			this.value = Math.min(max, Math.max(min, Math.round(v)));
			this.custom = custom;
			slider.value = String(this.value);
			label.setText(`${this.value}${this.custom ? "" : " (Standard)"}`);
			reset.toggleClass("is-active", !this.custom);
			opts.preview(this.value);
		};
		set(this.value, this.custom);
		slider.addEventListener("input", () => set(Number(slider.value)));
		minus.addEventListener("click", () => set(this.value - 1));
		plus.addEventListener("click", () => set(this.value + 1));
		reset.addEventListener("click", () => set(opts.defaultGap, false));
		done.addEventListener("click", () => this.close(false));
		// Eingaben im Popover nicht an Editor/Fläche weitergeben (Live Preview würde den Cursor setzen).
		for (const type of ["pointerdown", "mousedown", "touchstart"]) this.el.addEventListener(type, (e) => e.stopPropagation());

		document.addEventListener("pointerdown", this.onOutside, true);
		document.addEventListener("keydown", this.onKey, true);
		this.place(anchor);
		slider.focus();
	}

	private place(anchor: HTMLElement) {
		const r = anchor.getBoundingClientRect();
		const w = this.el.offsetWidth;
		const left = Math.min(Math.max(8, r.right - w), window.innerWidth - w - 8);
		this.el.style.left = `${left}px`;
		this.el.style.top = `${r.bottom + 6}px`;
	}

	private readonly onOutside = (e: PointerEvent) => {
		if (!this.el.contains(e.target as Node)) this.close(false);
	};

	private readonly onKey = (e: KeyboardEvent) => {
		if (e.key !== "Escape" && e.key !== "Enter") return;
		e.preventDefault();
		e.stopPropagation();
		this.close(e.key === "Escape");
	};

	/** Schließen; `cancel` verwirft die Vorschau, sonst wird übernommen (falls geändert). */
	close(cancel: boolean) {
		if (GapPopover.open !== this) return;
		GapPopover.open = null;
		document.removeEventListener("pointerdown", this.onOutside, true);
		document.removeEventListener("keydown", this.onKey, true);
		this.el.remove();
		const { pattern } = this.opts;
		const changed = this.custom !== pattern.custom || (this.custom && this.value !== pattern.gap);
		if (cancel || !changed) this.opts.preview(null);
		else this.opts.commit(this.custom ? this.value : null);
	}
}

function range(style: BgStyle): readonly [number, number] {
	return style === "ruled" ? LIMITS.ruledGap : LIMITS.gridGap;
}
