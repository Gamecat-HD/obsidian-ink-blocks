/**
 * Überprüfen erkannter Wörter: Aus dem Erkennungsergebnis eines Segments (Wörter mit x-Bereich) werden
 * Einträge mit den Strichen des jeweiligen Wortes.
 */
import type { Stroke } from "../model/ink-format";
import type { RecognizedSegment } from "../ocr/protocol";
import type { Box, Segment } from "../ocr/segment";
import { boxOf } from "../ocr/segment";
import { fnv1a } from "../util/hash";

/** Wörter mit geringerer Konfidenz gelten als unsicher und werden zuerst (bzw. allein) gefragt. */
export const UNSURE_CONF = 0.8;

/** Gemeinsamer Zustand eines Segments – mehrere Wörter daraus können nacheinander korrigiert werden. */
export interface ReviewSegment {
	inkPath: string;
	key: string;
	/** aktuelle Wörter (Korrekturen eingearbeitet, verworfene Wörter = "") */
	words: string[];
	strokes: Stroke[];
	box: Box;
}

export interface ReviewItem {
	seg: ReviewSegment;
	index: number;
	/** erkanntes Wort */
	word: string;
	conf: number;
	/** andere Lesarten dieses Wortes */
	alts: string[];
	strokes: Stroke[];
	/** Kennung des Wortes: Hash seiner Strich-IDs */
	key: string;
}

/** Striche auf die Wörter verteilen: nach der Mitte der Strich-Box im x-Bereich des Wortes. */
export function assignStrokes(strokes: Stroke[], words: { x0: number; x1: number }[]): Stroke[][] {
	const out = words.map(() => [] as Stroke[]);
	if (!words.length) return out;
	for (const s of strokes) {
		const b = boxOf([s]);
		const cx = (b.minX + b.maxX) / 2;
		let i = words.findIndex((w) => cx < w.x1);
		if (i < 0) i = words.length - 1;
		out[i].push(s);
	}
	return out;
}

/** Alternativen je Wort aus den Lesarten des ganzen Segments (nur solche mit gleicher Wortzahl). */
export function wordAlternatives(text: string, alts: string[], max = 3): string[][] {
	const words = text.split(" ");
	const out = words.map(() => [] as string[]);
	for (const alt of alts) {
		const aw = alt.split(" ");
		if (aw.length !== words.length) continue;
		aw.forEach((w, i) => {
			if (w && w !== words[i] && !out[i].includes(w) && out[i].length < max) out[i].push(w);
		});
	}
	return out;
}

export function wordKey(strokes: Stroke[]): string {
	return fnv1a(strokes.map((s) => s.id).sort().join(","));
}

/**
 * Einträge eines Segments. Ohne Wortausrichtung (oder wenn die Wörter nicht zum Text passen) wird das ganze
 * Segment ein Eintrag. Wörter ohne eigene Striche fallen weg.
 */
export function reviewItems(inkPath: string, seg: Segment, result: RecognizedSegment): ReviewItem[] {
	const text = result.text.trim();
	if (!text) return [];
	const words = result.words?.length && result.words.map((w) => w.text).join(" ") === text ? result.words : null;
	const shared: ReviewSegment = { inkPath, key: seg.key, words: words ? words.map((w) => w.text) : [text], strokes: seg.strokes, box: seg.box };
	if (!words) {
		return [{ seg: shared, index: 0, word: text, conf: result.confidence, alts: (result.alts ?? []).slice(0, 3), strokes: seg.strokes, key: wordKey(seg.strokes) }];
	}
	const parts = assignStrokes(seg.strokes, words);
	const alts = wordAlternatives(text, result.alts ?? []);
	const items: ReviewItem[] = [];
	words.forEach((w, i) => {
		if (!parts[i].length) return;
		items.push({ seg: shared, index: i, word: w.text, conf: w.conf, alts: alts[i], strokes: parts[i], key: wordKey(parts[i]) });
	});
	return items;
}

/** Segmenttext nach einer Korrektur: Wörter mit einem Leerzeichen, verworfene fallen raus. */
export function segmentText(seg: ReviewSegment): string {
	return seg.words.filter(Boolean).join(" ");
}
