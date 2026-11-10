// Erzeugt src/suggest/fontData.ts: Buchstaben aus dem Einstrich-Font EMS Readability (hersheytext).
// Nur nötig, wenn die Auswahl der Zeichen sich ändert: node scripts/build-stroke-font.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const file = join(dirname(require.resolve("hersheytext/package.json")), "svg_fonts", "EMSReadability.svg");
const svg = readFileSync(file, "utf8");
const CHARS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ-";

const glyphs = new Map();
for (const m of svg.matchAll(/<glyph\b([^>]*)\/?>/g)) {
	const attr = (k) => new RegExp(`${k}="([^"]*)"`).exec(m[1])?.[1];
	const ch = attr("unicode");
	if (ch === undefined || !CHARS.includes(ch)) continue;
	const strokes = [];
	let cur = null;
	for (const t of (attr("d") ?? "").matchAll(/([ML])\s*(-?[\d.]+)\s+(-?[\d.]+)/g)) {
		if (t[1] === "M") strokes.push((cur = []));
		cur?.push(Math.round(Number(t[2])), Math.round(Number(t[3])));
	}
	glyphs.set(ch, [Number(attr("horiz-adv-x") ?? 500), strokes]);
}
const missing = [...CHARS].filter((c) => !glyphs.has(c));
if (missing.length) throw new Error(`Fehlende Zeichen: ${missing.join("")}`);

const xs = glyphs.get("x")[1].flat().filter((_, i) => i % 2 === 1);
const body = [...glyphs].map(([ch, g]) => `\t${JSON.stringify(ch)}: ${JSON.stringify(g)},`).join("\n");
writeFileSync(
	"src/suggest/fontData.ts",
	`/*!
 * Glyphen aus EMS Readability (Sheldon B. Michaels, SVG: Windell H. Oskay), abgeleitet von Source Sans Pro-Light
 * (Paul D. Hunt, Adobe). Lizenz: SIL Open Font License 1.1, http://scripts.sil.org/OFL – vollständiger Text in
 * docs/licenses/OFL-EMS-Readability.txt
 */
// Erzeugt von scripts/build-stroke-font.mjs – nicht von Hand ändern.

/** Zeichen → [Vorschub, Striche als flache Listen x, y, …]; y wächst nach oben, Grundlinie bei 0, Einheiten 1/1000 em. */
export const FONT_X_HEIGHT = ${Math.max(...xs)};
export const FONT_GLYPHS: Record<string, [number, number[][]]> = {
${body}
};
`,
);
console.log(`${glyphs.size} Zeichen geschrieben`);
