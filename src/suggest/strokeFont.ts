import { FONT_GLYPHS } from "./fontData";

const UMLAUT: Record<string, string> = { ä: "a", ö: "o", ü: "u", Ä: "A", Ö: "O", Ü: "U" };
const FALLBACK_ADVANCE = 250;
/** Gleichmäßiger Druck; genau 0,5 hieße „Stift ohne Druckdaten“. */
const PRESSURE = 0.55;

const expand = (text: string) => text.replace(/ß/g, "ss");

/** Breite eines Textes in Font-Einheiten. */
export function textWidth(text: string): number {
	let w = 0;
	for (const ch of expand(text)) w += FONT_GLYPHS[UMLAUT[ch] ?? ch]?.[0] ?? FALLBACK_ADVANCE;
	return w;
}

/** Text als Striche `[x, y, p, …]`; `k` = Doc-Einheiten je Font-Einheit, (x, y) = Anfang der Grundlinie. */
export function textStrokes(text: string, x: number, y: number, k: number): number[][] {
	const out: number[][] = [];
	let cx = x;
	for (const ch of expand(text)) {
		const base = UMLAUT[ch] ?? ch;
		const glyph = FONT_GLYPHS[base];
		if (!glyph) {
			cx += FALLBACK_ADVANCE * k;
			continue;
		}
		for (const s of glyph[1]) {
			const pts: number[] = [];
			for (let i = 0; i < s.length; i += 2) pts.push(cx + s[i] * k, y - s[i + 1] * k, PRESSURE);
			out.push(pts);
		}
		if (UMLAUT[ch]) {
			const top = y - (ch === ch.toUpperCase() ? 820 : 620) * k;
			const middle = cx + (glyph[0] * k) / 2;
			for (const dx of [-85, 85]) {
				const px = middle + dx * k;
				out.push([px, top, PRESSURE, px, top + 60 * k, PRESSURE]);
			}
		}
		cx += glyph[0] * k;
	}
	return out;
}
