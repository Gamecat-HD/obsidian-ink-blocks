import type { Stroke } from "../model/ink-format";
import { boxOf, type Box } from "../ocr/segment";
import { FONT_X_HEIGHT } from "./fontData";
import { textStrokes, textWidth } from "./strokeFont";

/** Ein Buchstabe aus der eigenen Schrift. Koordinaten in x-Höhen: x ab linker Kante, y ab Grundlinie (nach unten positiv). */
export interface Glyph {
	strokes: number[][];
	width: number;
	height: number;
	/** Einzeln geschrieben (Buchstaben-Training): Die Zuordnung ist sicher. */
	isolated?: boolean;
}

export interface GlyphSample {
	text: string;
	strokes: number[][];
}

const X_HEIGHT_LETTERS = new Set("acemnorsuvwxz");
/** Unter der Grundlinie endende oder dafür untaugliche Zeichen zählen nicht für deren Bestimmung. */
const NOT_ON_BASELINE = new Set("gjpqyßQ,;()/'\"-_=+*");
const ASCENDERS = new Set("bdfhklt");
const DESCENDERS = new Set("gjpqy");
const UMLAUT: Record<string, string> = { ä: "a", ö: "o", ü: "u", Ä: "A", Ö: "O", Ü: "U" };
/** Von den Varianten eines Buchstabens kommen so viele zum Einsatz: die typischsten. */
const VARIANTS = 4;
/** Varianten, die in Breite oder Höhe stärker als so vom Median abweichen, gelten als Fehlschnitt. */
const OUTLIER = 0.4;
const DEFAULT_GAP = 0.25;
/** Breite eines Leerzeichens (x-Höhen) */
const WORD_SPACE = 0.9;
/** Mit weniger Beispielen ist nicht zu prüfen, ob die Zuordnung stimmt. */
const MIN_SAMPLES = 2;
/** So viele Beispiele je Zeichen werden verglichen; mehr kostet nur Rechenzeit. */
const MAX_COMPARED = 40;
const SHAPE_POINTS = 24;
/** Ab so vielen Beispielen aus normalen Wörtern braucht ein Buchstabe keine Übung. */
const ENOUGH = 6;
/** Diese Buchstaben werden aus normalen Wörtern oft falsch ausgeschnitten: Sie bestehen aus getrennten Strichen. */
const NEEDS_ISOLATED = new Set("kt");

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const toStroke = (points: number[], i: number): Stroke => ({ id: `g${i}`, tool: "pen", color: 0, size: 3, points });

interface Cluster {
	strokes: number[][];
	box: Box;
}

interface Pair {
	ch: string;
	c: Cluster;
	isolated: boolean;
}

function unite(a: Box, b: Box): Box {
	return { minX: Math.min(a.minX, b.minX), minY: Math.min(a.minY, b.minY), maxX: Math.max(a.maxX, b.maxX), maxY: Math.max(a.maxY, b.maxY) };
}

/** Passt die Form grob zum Zeichen? Verrutscht die Zuordnung in einem Wort, fällt das hier meist auf. */
function plausible(ch: string, height: number, below: number): boolean {
	if (DESCENDERS.has(ch)) return below >= 0.25;
	if (ASCENDERS.has(ch)) return height >= 1.15;
	if (X_HEIGHT_LETTERS.has(ch)) return height <= 1.6 && below <= 0.45;
	if (ch !== ch.toLowerCase()) return height >= 1.15;
	return true;
}

/** Gleichmäßig verteilte Punkte auf einem Buchstaben, zum Vergleichen von Formen. */
function shapePoints(g: Glyph): number[] {
	const pts: number[] = [];
	const total = g.strokes.reduce((n, s) => n + s.length / 3, 0);
	const step = Math.max(1, Math.floor(total / SHAPE_POINTS));
	let i = 0;
	for (const s of g.strokes) for (let k = 0; k < s.length; k += 3) if (i++ % step === 0) pts.push(s[k], s[k + 1]);
	return pts;
}

/** Mittlerer Abstand von jedem Punkt in `a` zum nächsten Punkt in `b` (x-Höhen). */
function oneWay(a: number[], b: number[]): number {
	let sum = 0;
	for (let i = 0; i < a.length; i += 2) {
		let best = Infinity;
		for (let k = 0; k < b.length; k += 2) best = Math.min(best, (a[i] - b[k]) ** 2 + (a[i + 1] - b[k + 1]) ** 2);
		sum += Math.sqrt(best);
	}
	return sum / (a.length / 2);
}

/** Striche → Buchstaben-Kandidaten von links nach rechts: Was sich waagerecht überlappt, gehört zusammen; Punkte oben hängen am nächsten Buchstaben. */
function clusters(strokes: number[][]): Cluster[] {
	const items = strokes.map((points, i) => ({ points, box: boxOf([toStroke(points, i)]) }));
	const H = median(items.map((s) => s.box.maxY - s.box.minY));
	const mid = (Math.min(...items.map((s) => s.box.minY)) + Math.max(...items.map((s) => s.box.maxY))) / 2;
	const isDot = (b: Box) => b.maxY - b.minY < 0.35 * H && b.maxX - b.minX < 0.6 * H && (b.minY + b.maxY) / 2 < mid;
	const bodies = items.filter((s) => !isDot(s.box)).sort((a, b) => a.box.minX - b.box.minX);
	const out: Cluster[] = [];
	for (const s of bodies) {
		const last = out[out.length - 1];
		if (last && s.box.minX <= last.box.maxX) {
			last.strokes.push(s.points);
			last.box = unite(last.box, s.box);
		} else {
			out.push({ strokes: [s.points], box: s.box });
		}
	}
	for (const s of items.filter((d) => isDot(d.box))) {
		if (!out.length) continue;
		const cx = (s.box.minX + s.box.maxX) / 2;
		const distance = (c: Cluster) => (cx < c.box.minX ? c.box.minX - cx : cx > c.box.maxX ? cx - c.box.maxX : 0);
		const nearest = out.reduce((a, b) => (distance(b) < distance(a) ? b : a));
		nearest.strokes.push(s.points);
		nearest.box = unite(nearest.box, s.box);
	}
	return out;
}

/** Kandidaten auf die Wörter verteilen: die größten Lücken sind die Wortgrenzen. */
function splitWords(list: Cluster[], spaces: number): Cluster[][] | null {
	if (list.length <= spaces) return null;
	const gaps = list.slice(1).map((c, i) => ({ i: i + 1, gap: c.box.minX - list[i].box.maxX }));
	const cuts = new Set(gaps.sort((a, b) => b.gap - a.gap).slice(0, spaces).map((g) => g.i));
	const words: Cluster[][] = [[]];
	list.forEach((c, i) => {
		if (cuts.has(i)) words.push([]);
		words[words.length - 1].push(c);
	});
	return words;
}

/** Buchstaben eines Wortes zuordnen. Stimmt die Zahl nicht, wäre jede Zuordnung geraten: dann lieber gar nicht. */
function pair(chars: string[], word: Cluster[] | undefined): Pair[] | null {
	if (!word) return null;
	if (chars.length === 1) {
		const merged = word.reduce((a, b) => ({ strokes: [...a.strokes, ...b.strokes], box: unite(a.box, b.box) }));
		return [{ ch: chars[0], c: merged, isolated: true }];
	}
	return word.length === chars.length ? word.map((c, i) => ({ ch: chars[i], c, isolated: false })) : null;
}

/** Grundlinie und x-Höhe aus den Buchstaben, die sich dafür eignen. */
function metrics(pairs: Pair[]): { baseline: number; x: number } | null {
	const onLine = pairs.filter((p) => !NOT_ON_BASELINE.has(p.ch)).map((p) => p.c.box.maxY);
	const small = pairs.filter((p) => X_HEIGHT_LETTERS.has(p.ch)).map((p) => p.c.box.maxY - p.c.box.minY);
	if (!onLine.length || !small.length) return null;
	const x = median(small);
	return x > 0 ? { baseline: median(onLine), x } : null;
}

/** Sammlung der eigenen Buchstaben, ausgeschnitten aus den Proben des Schreibtrainings. */
export class GlyphLibrary {
	private readonly raw = new Map<string, Glyph[]>();
	private readonly gaps: number[] = [];
	private picked = new Map<string, Glyph[]>();
	/** Wie viele Wörter sich sauber zerlegen ließen */
	wordsUsed = 0;
	wordsSkipped = 0;

	add({ text, strokes }: GlyphSample) {
		const names = text.trim().split(/\s+/);
		if (!strokes.length || !names[0]) return;
		const words = splitWords(clusters(strokes), names.length - 1);
		if (!words) {
			this.wordsSkipped += names.length;
			return;
		}
		const matched = names.map((name, n) => pair(Array.from(name), words[n]));
		// Einzelne Buchstaben haben allein keine x-Höhe: Dann gilt der Bezug der ganzen Probe.
		const whole = metrics(matched.flatMap((m) => m ?? []));
		for (const pairs of matched) {
			const ref = pairs && (metrics(pairs) ?? whole);
			if (!pairs || !ref || !pairs.every((p) => plausible(p.ch, (p.c.box.maxY - p.c.box.minY) / ref.x, (p.c.box.maxY - ref.baseline) / ref.x))) {
				this.wordsSkipped++;
				continue;
			}
			this.wordsUsed++;
			this.store(pairs, ref);
		}
		this.picked = new Map();
	}

	private store(pairs: Pair[], { baseline, x }: { baseline: number; x: number }) {
		pairs.forEach(({ ch, c, isolated }, i) => {
			if (i) this.gaps.push((c.box.minX - pairs[i - 1].c.box.maxX) / x);
			const list = this.raw.get(ch) ?? [];
			list.push({
				strokes: c.strokes.map((s) => s.map((v, k) => (k % 3 === 0 ? (v - c.box.minX) / x : k % 3 === 1 ? (v - baseline) / x : v))),
				width: (c.box.maxX - c.box.minX) / x,
				height: (c.box.maxY - c.box.minY) / x,
				isolated,
			});
			this.raw.set(ch, list);
		});
	}

	/**
	 * Die typischsten Varianten eines Zeichens: jene, die den meisten anderen Beispielen ähneln. Falsch zugeordnete
	 * Buchstaben sind in der Minderheit und fallen so heraus. Einzeln geschriebene gehen vor, sie sind sicher.
	 */
	private variants(ch: string): Glyph[] {
		let list = this.picked.get(ch);
		if (list) return list;
		const found = this.raw.get(ch) ?? [];
		const isolated = found.filter((g) => g.isolated);
		const all = isolated.length >= MIN_SAMPLES ? isolated : found;
		if (all.length < MIN_SAMPLES) {
			this.picked.set(ch, []);
			return [];
		}
		const w = median(all.map((g) => g.width));
		const h = median(all.map((g) => g.height));
		const fits = all.filter((g) => Math.abs(g.width - w) <= OUTLIER * Math.max(w, 0.1) && Math.abs(g.height - h) <= OUTLIER * Math.max(h, 0.1));
		const pool = (fits.length >= MIN_SAMPLES ? fits : all).slice(-MAX_COMPARED);
		const shapes = pool.map(shapePoints);
		const neighbours = Math.max(1, Math.ceil(pool.length / 2));
		const score = pool.map((_, i) => {
			const d = shapes.map((s, k) => (k === i ? Infinity : Math.max(oneWay(shapes[i], s), oneWay(s, shapes[i]))));
			return d.sort((a, b) => a - b).slice(0, neighbours).reduce((n, v) => n + v, 0) / neighbours;
		});
		list = pool.map((g, i) => ({ g, s: score[i] })).sort((a, b) => a.s - b.s).slice(0, VARIANTS).map((x) => x.g);
		this.picked.set(ch, list);
		return list;
	}

	count(ch: string): number {
		return this.raw.get(ch)?.length ?? 0;
	}

	get chars(): string[] {
		return [...this.raw.keys()];
	}

	/** Lohnt es sich, diesen Buchstaben im Training einzeln zu schreiben? */
	needsPractice(ch: string): boolean {
		const found = this.raw.get(ch) ?? [];
		if (found.filter((g) => g.isolated).length >= MIN_SAMPLES) return false;
		return found.length < ENOUGH || NEEDS_ISOLATED.has(ch);
	}

	/** Abstand zwischen Buchstaben (x-Höhen). */
	get gap(): number {
		return this.gaps.length ? Math.max(0, median(this.gaps)) : DEFAULT_GAP;
	}

	/** Variante für die Position `index` im Text; dieselben Buchstaben sehen so nicht identisch aus. */
	glyph(ch: string, index: number): Glyph | null {
		const list = this.variants(ch);
		return list.length ? list[index % list.length] : null;
	}

	/** Eigener Buchstabe; ein Umlaut notfalls aus dem eigenen Grundbuchstaben; sonst die Druckschrift. */
	private resolve(ch: string, index: number): Glyph {
		if (ch === " ") return { strokes: [], width: WORD_SPACE, height: 0 };
		const own = this.glyph(ch, index);
		if (own) return own;
		const base = UMLAUT[ch] ? this.glyph(UMLAUT[ch], index) : null;
		if (base) return withDots(base);
		const strokes = textStrokes(ch, 0, 0, 1 / FONT_X_HEIGHT);
		return { strokes, width: Math.max(0.1, textWidth(ch) / FONT_X_HEIGHT - this.gap), height: 1 };
	}

	private chars_(text: string): string[] {
		return Array.from(this.count("ß") >= MIN_SAMPLES ? text : text.replace(/ß/g, "ss"));
	}

	/** Breite eines Textes in x-Höhen. */
	width(text: string): number {
		const chars = this.chars_(text);
		return chars.reduce((w, ch, i) => w + this.resolve(ch, i).width, 0) + Math.max(0, chars.length - 1) * this.gap;
	}

	/** Text als Striche `[x, y, p, …]`; `unit` = Doc-Einheiten je x-Höhe, (x, y) = Anfang der Grundlinie. */
	render(text: string, x: number, y: number, unit: number, offset = 0): number[][] {
		const out: number[][] = [];
		let cx = x;
		this.chars_(text).forEach((ch, i) => {
			const g = this.resolve(ch, i + offset);
			for (const s of g.strokes) out.push(s.map((v, k) => (k % 3 === 0 ? cx + v * unit : k % 3 === 1 ? y + v * unit : v)));
			cx += (g.width + this.gap) * unit;
		});
		return out;
	}
}

function withDots(base: Glyph): Glyph {
	let top = Infinity;
	for (const s of base.strokes) for (let k = 1; k < s.length; k += 3) top = Math.min(top, s[k]);
	const y = top - 0.3;
	const dots = [0.3, 0.7].map((f) => [base.width * f, y, 0.6, base.width * f + 0.04, y + 0.06, 0.6]);
	return { strokes: [...base.strokes, ...dots], width: base.width, height: base.height + 0.3 };
}

/** Bibliothek aus allen Proben mit Text. */
export function buildGlyphLibrary(samples: { text: string | null; strokes: number[][] }[]): GlyphLibrary {
	const library = new GlyphLibrary();
	for (const s of samples) if (s.text?.trim()) library.add({ text: s.text, strokes: s.strokes });
	return library;
}
