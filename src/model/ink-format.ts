/**
 * `.ink`-Dateiformat v1.
 *
 * Im Speicher liegen Punkte als flaches Array `[x, y, p, x, y, p, …]` in Doc-Einheiten (p ∈ [0, 1]).
 * Auf Platte werden x/y mit `q` quantisiert, p auf 0..255 abgebildet und alles delta-codiert.
 * Jeder Strich steht in einer eigenen Zeile, damit Diffs und LiveSync-Chunks klein bleiben.
 */

export type Tool = "pen" | "hl";
export type Space = "nb" | "page";

export interface Stroke {
	id: string;
	tool: Tool;
	/** Palettenindex, 0 = „Tinte“ (Theme-Textfarbe bzw. Schwarz auf Arbeitsblättern). */
	color: number;
	/** Strichbreite in Doc-Einheiten. */
	size: number;
	points: number[];
	/** Kein echter Druck (Maus/Finger) – perfect-freehand simuliert ihn aus der Geschwindigkeit. */
	simulated?: boolean;
}

export interface InkBackground {
	kind: "pdf" | "image";
	page?: number;
	/** Native Größe des Hintergrunds (PDF-Punkte bzw. Bildpixel) beim Anlegen. */
	pw: number;
	ph: number;
}

export interface OcrState {
	engine: string;
	lines: Record<string, string>;
	/** Hash des zuletzt von uns geschriebenen `text:`-Inhalts. */
	written: string;
}

export interface InkData {
	v: 1;
	id: string;
	space: Space;
	/** Logische Breite: im Heft-Modus immer NB_WIDTH, im Seiten-Modus die Hintergrundbreite. */
	w: number;
	h: number;
	bg?: InkBackground;
	strokes: Stroke[];
	ocr?: OcrState;
}

export const NB_WIDTH = 1000;
export const NB_MIN_HEIGHT = 400;
const Q = 10;

export class InkFormatError extends Error {}

export function createNotebook(id: string, h = NB_MIN_HEIGHT): InkData {
	return { v: 1, id, space: "nb", w: NB_WIDTH, h, strokes: [] };
}

/** Arbeitsblatt: Koordinaten in nativen Einheiten des Hintergrunds (PDF-Punkte bzw. Bildpixel). */
export function createPage(id: string, bg: InkBackground): InkData {
	return { v: 1, id, space: "page", w: bg.pw, h: bg.ph, bg, strokes: [] };
}

export function encodePoints(points: number[], q = Q): number[] {
	const out: number[] = new Array(points.length);
	let px = 0;
	let py = 0;
	let pp = 0;
	for (let i = 0; i < points.length; i += 3) {
		const x = Math.round(points[i] * q);
		const y = Math.round(points[i + 1] * q);
		const p = Math.round(Math.min(1, Math.max(0, points[i + 2])) * 255);
		out[i] = x - px;
		out[i + 1] = y - py;
		out[i + 2] = p - pp;
		px = x;
		py = y;
		pp = p;
	}
	return out;
}

export function decodePoints(encoded: number[], q = Q): number[] {
	const out: number[] = new Array(encoded.length);
	let x = 0;
	let y = 0;
	let p = 0;
	for (let i = 0; i < encoded.length; i += 3) {
		x += encoded[i];
		y += encoded[i + 1];
		p += encoded[i + 2];
		out[i] = x / q;
		out[i + 1] = y / q;
		out[i + 2] = p / 255;
	}
	return out;
}

interface StoredStroke {
	id: string;
	t: Tool;
	c: number;
	s: number;
	p: number[];
	sp?: 1;
}

export function encodeInk(doc: InkData): string {
	const head: Record<string, unknown> = { v: doc.v, id: doc.id, space: doc.space, w: doc.w, h: doc.h, q: Q };
	if (doc.bg) head.bg = doc.bg;
	if (doc.ocr) head.ocr = doc.ocr;
	const strokes = doc.strokes.map((s) => {
		const stored: StoredStroke = { id: s.id, t: s.tool, c: s.color, s: s.size, p: encodePoints(s.points) };
		if (s.simulated) stored.sp = 1;
		return JSON.stringify(stored);
	});
	const headJson = JSON.stringify(head).slice(0, -1);
	return `${headJson},"strokes":[${strokes.length ? `\n${strokes.join(",\n")}\n` : ""}]}\n`;
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export function decodeInk(text: string): InkData {
	let raw: Record<string, unknown>;
	try {
		raw = JSON.parse(text);
	} catch (e) {
		throw new InkFormatError(`Kein gültiges JSON: ${(e as Error).message}`);
	}
	if (raw?.v !== 1) throw new InkFormatError(`Unbekannte Version: ${String(raw?.v)}`);
	if (typeof raw.id !== "string") throw new InkFormatError("id fehlt");
	if (raw.space !== "nb" && raw.space !== "page") throw new InkFormatError("space ungültig");
	if (!isNum(raw.w) || !isNum(raw.h) || raw.w <= 0 || raw.h <= 0) throw new InkFormatError("w/h ungültig");
	const q = isNum(raw.q) && raw.q > 0 ? raw.q : Q;
	if (!Array.isArray(raw.strokes)) throw new InkFormatError("strokes fehlt");

	const strokes = (raw.strokes as StoredStroke[]).map((s, i) => {
		if (typeof s?.id !== "string" || (s.t !== "pen" && s.t !== "hl") || !isNum(s.c) || !isNum(s.s)) {
			throw new InkFormatError(`Strich ${i} ungültig`);
		}
		if (!Array.isArray(s.p) || s.p.length % 3 !== 0 || !s.p.every(isNum)) {
			throw new InkFormatError(`Punkte von Strich ${i} ungültig`);
		}
		const stroke: Stroke = { id: s.id, tool: s.t, color: s.c, size: s.s, points: decodePoints(s.p, q) };
		if (s.sp) stroke.simulated = true;
		return stroke;
	});

	const doc: InkData = { v: 1, id: raw.id, space: raw.space, w: raw.w, h: raw.h, strokes };
	if (raw.bg) doc.bg = raw.bg as InkBackground;
	if (raw.ocr) doc.ocr = raw.ocr as OcrState;
	return doc;
}
