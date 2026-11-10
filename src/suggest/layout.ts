import type { Stroke } from "../model/ink-format";
import { boxOf, referenceHeight, segmentLines, type Box } from "../ocr/segment";
import { GlyphLibrary } from "./glyphs";

/** Obergrenze fürs Erkennen (Zeilenhöhen), falls in durchgezogener Schrift keine Wortlücke zu finden ist. */
const TRAILING_HEIGHTS = 10;
/**
 * Lücke, ab der ein neues Wort beginnt (Zeilenhöhen). An 115 echten Schriftproben gemessen: Bei 0,5 wurden 5,8 %
 * der Lücken im Wort als Wortende gewertet, bei 1 nur noch 0,2 %. Lieber ein Wort zu viel als ein halbes.
 */
const WORD_GAP = 1;
/** Schmaler als das (Zeilenhöhen) sind noch keine drei Buchstaben: nicht erst erkennen. */
const MIN_WORD_WIDTH = 1;
/** Linke Kante des Vorschlags ist frei für Satzzeichen (Anteil der Zeilenhöhe). */
const HIT_LEFT_FREE = 0.6;
const HIT_PAD = 6;
/** Beim Umbruch höchstens so viele Zeilen */
const MAX_LINES = 3;
/** Platzbedarf über und unter der Grundlinie (x-Höhen), um freie Bereiche zu prüfen */
const ABOVE = 1.6;
const BELOW = 0.6;

export interface WritingFront {
	/** Striche des aktuellen Wortes, fürs Erkennen. */
	strokes: Stroke[];
	/** Striche des Wortes davor (leer am Zeilenanfang) */
	previous: Stroke[];
	/** Das Ende der Zeile, höchstens 10 Zeilenhöhen */
	line: Stroke[];
}

/**
 * Das Ende der Zeile, an der gerade geschrieben wird – oder `null`, wenn `last` nicht vorne liegt (etwa ein
 * nachgetragener Strich mitten im Text). Dort wäre für einen Vorschlag auch kein Platz.
 */
export function writingFront(all: Stroke[], last: Stroke): WritingFront | null {
	if (last.tool !== "pen" || last.shape) return null;
	const pen = all.filter((s) => s.tool === "pen" && !s.shape);
	const H = referenceHeight(pen);
	for (const line of segmentLines(all)) {
		const seg = line.find((s) => s.strokes.some((st) => st.id === last.id));
		if (!seg) continue;
		// Im selben Abstand darf rechts davon nichts stehen, sonst überschreibt der Vorschlag Vorhandenes.
		if (line[line.length - 1] !== seg) return null;
		const from = seg.box.maxX - TRAILING_HEIGHTS * H;
		const trailing = seg.strokes.filter((s) => boxOf([s]).maxX >= from);
		const { word, previous } = lastWords(trailing, H);
		// Im letzten Wort zählt jeder Strich, auch ein nachgetragener i-Punkt; davor wird nur noch korrigiert.
		if (!word.some((s) => s.id === last.id)) return null;
		const box = boxOf(word);
		return box.maxX - box.minX < MIN_WORD_WIDTH * H ? null : { strokes: word, previous, line: trailing };
	}
	return null;
}

/** Von rechts das aktuelle Wort und das davor: Je schmaler das Bild, desto schneller die Erkennung. */
function lastWords(strokes: Stroke[], H: number): { word: Stroke[]; previous: Stroke[] } {
	const sorted = strokes.map((s) => ({ s, b: boxOf([s]) })).sort((a, b) => b.b.maxX - a.b.maxX);
	const word: Stroke[] = [];
	const previous: Stroke[] = [];
	let target = word;
	let left = Infinity;
	for (const { s, b } of sorted) {
		if (target.length && left - b.maxX > WORD_GAP * H) {
			if (target === previous) break;
			target = previous;
			left = Infinity;
		}
		target.push(s);
		left = Math.min(left, b.minX);
	}
	return { word, previous };
}

type Rect = Box;

export interface Ghost {
	strokes: number[][];
	/** Hülle der ersten Zeile des Vorschlags (Doc-Einheiten) */
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
	/** Links davon gilt Antippen nicht als Annehmen. */
	hitMinX: number;
	/** Hülle jeder Zeile */
	lines: Rect[];
	/** Tatsächlich gezeigter Text (mit führendem Leerzeichen, wenn er ein neues Wort beginnt) */
	text: string;
	/** Ab diesem Strich beginnt die letzte Zeile des Vorschlags, und das ist ihr Text. */
	lastLineFrom: number;
	lastLineText: string;
}

/** Wie der Vorschlag umbricht: Grenzen in Doc-Einheiten und Prüfung, ob ein Bereich frei ist. */
export interface Wrap {
	left: number;
	right: number;
	bottom: number;
	/** Abstand zweier Zeilen bei dieser Schriftgröße */
	step(unit: number): number;
	free(box: Box): boolean;
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

/**
 * Den fehlenden Rest hinter das geschriebene Wort setzen: Größe aus der Breite des Geschriebenen, damit er zu
 * Druck- wie Schreibschrift passt (die Strichhöhe taugt bei durchgezogener Schrift nicht als Maß). Die Striche
 * stammen aus der eigenen Schrift, soweit `library` den Buchstaben kennt.
 */
export function layoutGhost(prefix: string, rest: string, word: Stroke[], library = new GlyphLibrary(), wrap?: Wrap): Ghost | null {
	if (!word.length) return null;
	const box = boxOf(word);
	const H = referenceHeight(word);
	const unit = Math.min(H * 1.6, Math.max(H * 0.6, (box.maxX - box.minX) / Math.max(0.1, library.width(prefix))));
	const baseline = median(word.map((s) => boxOf([s]).maxY));
	const x = box.maxX + library.gap * unit;
	const startsNew = rest.startsWith(" ");
	const tokens = rest.trim().split(/\s+/).filter(Boolean);
	const space = (library.width(" ") + library.gap) * unit;
	const strokes: number[][] = [];
	const shown: string[] = [];
	const lines: { from: number; texts: string[] }[] = [{ from: 0, texts: [] }];
	let cursor = x;
	let y = baseline;
	let offset = Array.from(prefix).length;
	for (const token of tokens) {
		const width = library.width(token) * unit;
		const line = lines[lines.length - 1];
		let at = cursor + (line.texts.length || (startsNew && !shown.length) ? space : 0);
		const area = (left: number, base: number): Box => ({ minX: left, maxX: left + width, minY: base - ABOVE * unit, maxY: base + BELOW * unit });
		if (wrap && at + width > wrap.right) {
			const next = y + wrap.step(unit);
			if (lines.length >= MAX_LINES || wrap.left + width > wrap.right || next + BELOW * unit > wrap.bottom || !wrap.free(area(wrap.left, next))) break;
			y = next;
			at = wrap.left;
			lines.push({ from: strokes.length, texts: [] });
		} else if (wrap && lines.length > 1 && !wrap.free(area(at, y))) {
			break;
		}
		lines[lines.length - 1].texts.push(token);
		strokes.push(...library.render(token, at, y, unit, offset));
		shown.push(token);
		cursor = at + width;
		offset += Array.from(token).length + 1;
	}
	if (!strokes.length) return null;
	const used = lines.filter((l) => l.texts.length);
	const rects = used.map((l, i) => bounds(strokes.slice(l.from, used[i + 1]?.from ?? strokes.length)));
	const first = rects[0];
	const last = used[used.length - 1];
	return {
		strokes,
		...first,
		hitMinX: first.minX + Math.min(HIT_LEFT_FREE * H, (first.maxX - first.minX) / 3),
		lines: rects,
		text: (startsNew ? " " : "") + shown.join(" "),
		lastLineFrom: last.from,
		lastLineText: last.texts.join(" "),
	};
}

function bounds(strokes: number[][]): Rect {
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	for (const s of strokes) {
		for (let i = 0; i < s.length; i += 3) {
			minX = Math.min(minX, s[i]);
			maxX = Math.max(maxX, s[i]);
			minY = Math.min(minY, s[i + 1]);
			maxY = Math.max(maxY, s[i + 1]);
		}
	}
	return { minX, minY, maxX, maxY };
}

/** Linke Kante der Zeile, zu der `last` gehört. */
export function lineLeft(all: Stroke[], last: Stroke): number | null {
	for (const line of segmentLines(all)) if (line.some((seg) => seg.strokes.some((s) => s.id === last.id))) return line[0].box.minX;
	return null;
}

/** Liegt (x, y) im Bereich, in dem Antippen den Vorschlag annimmt? */
export function ghostHit(g: Ghost, x: number, y: number): boolean {
	return g.lines.some((r, i) => x >= (i === 0 ? g.hitMinX : r.minX - HIT_PAD) && x <= r.maxX + HIT_PAD && y >= r.minY - HIT_PAD && y <= r.maxY + HIT_PAD);
}
