/** Hintergrundmuster einer Heft-Fläche: Stil und Linienabstand bzw. Kästchengröße (Doc-Einheiten). */

export type BgStyle = "ruled" | "grid" | "dots" | "blank";

export interface Pattern {
	style: BgStyle;
	gap: number;
	/** Abstand kommt aus dem Block (`gap:`), nicht aus den Einstellungen. */
	custom: boolean;
}

/** Änderung über das Hintergrund-Menü. `gap: null` = Feld entfernen (Standard aus den Einstellungen). */
export interface PatternChange {
	style?: BgStyle;
	gap?: number | null;
}

export interface PatternDefaults {
	bgStyle: BgStyle;
	ruledGap: number;
	gridGap: number;
}

export const GAP_PRESETS: Record<Exclude<BgStyle, "blank">, { label: string; value: number }[]> = {
	ruled: [
		{ label: "Eng", value: 30 },
		{ label: "Mittel", value: 40 },
		{ label: "Weit", value: 55 },
	],
	grid: [
		{ label: "Klein", value: 18 },
		{ label: "Mittel", value: 25 },
		{ label: "Groß", value: 35 },
	],
	dots: [
		{ label: "Klein", value: 18 },
		{ label: "Mittel", value: 25 },
		{ label: "Groß", value: 35 },
	],
};

/** Plausible Grenzen für `gap:` im Block (Tippfehler sollen keine 1-px-Linien erzeugen). */
const GAP_MIN = 8;
const GAP_MAX = 200;

export function isBgStyle(v: unknown): v is BgStyle {
	return v === "ruled" || v === "grid" || v === "dots" || v === "blank";
}

export function parseGap(v: string | undefined): number | null {
	if (v === undefined || v.trim() === "") return null;
	const n = Number(v);
	return Number.isFinite(n) && n >= GAP_MIN && n <= GAP_MAX ? n : null;
}

export function defaultGap(style: BgStyle, d: PatternDefaults): number {
	// Punkteraster: gleiche Maße wie Kästchen.
	return style === "ruled" ? d.ruledGap : d.gridGap;
}

/** Muster eines Blocks aus seinen Feldern (`bgStyle:`, `gap:`), sonst aus den Einstellungen. */
export function resolvePattern(fields: { bgStyle?: string; gap?: string }, d: PatternDefaults): Pattern {
	const style = isBgStyle(fields.bgStyle) ? fields.bgStyle : d.bgStyle;
	const gap = parseGap(fields.gap);
	return { style, gap: gap ?? defaultGap(style, d), custom: gap !== null };
}

/**
 * Welche Block-Felder eine Änderung schreibt. Ein Stilwechsel setzt den Abstand zurück, weil Zeilen- und
 * Kästchenmaße verschieden sind.
 */
export function patternFields(current: Pattern, change: PatternChange): Record<string, string | undefined> {
	const out: Record<string, string | undefined> = {};
	if (change.style && change.style !== current.style) {
		out.bgStyle = change.style;
		if (current.custom) out.gap = undefined;
	}
	if (change.gap !== undefined) out.gap = change.gap === null ? undefined : String(change.gap);
	// Ein eigener Abstand gilt nur zusammen mit seinem Stil (sonst würde aus 55 Zeilenabstand nach einem
	// Wechsel des Standardstils eine Kästchengröße).
	if (typeof change.gap === "number") out.bgStyle = change.style ?? current.style;
	return out;
}
