// Text → Striche (wie mit dem Stift geschrieben) aus Einstrich-SVG-Fonts (hersheytext, EMS/Hershey).
// Umlaute werden aus Grundbuchstabe + zwei Punkt-Strichen zusammengesetzt, ß als „ss“.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const FONT_DIR = join(dirname(require.resolve("hersheytext/package.json")), "svg_fonts");

const cache = new Map();
function loadFont(name) {
	if (cache.has(name)) return cache.get(name);
	const svg = readFileSync(join(FONT_DIR, `${name}.svg`), "utf8");
	const glyphs = new Map();
	for (const m of svg.matchAll(/<glyph\b([^>]*)\/?>/g)) {
		const attr = (k) => new RegExp(`${k}="([^"]*)"`).exec(m[1])?.[1];
		let uni = attr("unicode");
		if (uni === undefined) continue;
		uni = uni.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&apos;/g, "'");
		const d = attr("d") ?? "";
		const strokes = [];
		let cur = null;
		for (const t of d.matchAll(/([ML])\s*(-?[\d.]+)\s+(-?[\d.]+)/g)) {
			if (t[1] === "M") strokes.push((cur = []));
			cur?.push([Number(t[2]), Number(t[3])]);
		}
		glyphs.set(uni, { adv: Number(attr("horiz-adv-x") ?? 500), strokes });
	}
	const font = { glyphs, defaultAdv: Number(/horiz-adv-x="([\d.]+)"/.exec(svg)?.[1] ?? 500) };
	cache.set(name, font);
	return font;
}

const UMLAUT = { ä: "a", ö: "o", ü: "u", Ä: "A", Ö: "O", Ü: "U" };

/**
 * @returns {number[][]} Striche als flache Punktlisten [x, y, p, …] in Doc-Einheiten.
 * `size` = Em-Höhe in Doc-Einheiten, (x, y) = Anfang der Grundlinie.
 */
export function textToStrokes(text, { font = "EMSAllure", x = 40, y = 80, size = 60, jitter = 0.6, seed = 1 } = {}) {
	const f = loadFont(font);
	const k = size / 1000;
	let rnd = seed;
	const random = () => ((rnd = (rnd * 16807) % 2147483647) / 2147483647);
	const out = [];
	let cx = x;
	for (const ch of text.replace(/ß/g, "ss")) {
		const base = UMLAUT[ch] ?? ch;
		const g = f.glyphs.get(base);
		if (!g) {
			cx += f.defaultAdv * k * 0.5;
			continue;
		}
		for (const s of g.strokes) {
			const pts = [];
			for (const [gx, gy] of s) pts.push(cx + gx * k + (random() - 0.5) * jitter, y - gy * k + (random() - 0.5) * jitter, 0.45 + random() * 0.3);
			out.push(pts);
		}
		if (UMLAUT[ch]) {
			const top = y - (ch === ch.toUpperCase() ? 820 : 560) * k;
			for (const fx of [0.3, 0.62]) {
				const px = cx + g.adv * k * fx;
				out.push([px, top, 0.6, px + 1.2, top + 1.2, 0.6]);
			}
		}
		cx += g.adv * k;
	}
	return out;
}
