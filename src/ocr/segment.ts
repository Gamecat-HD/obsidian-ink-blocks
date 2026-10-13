import type { Stroke } from "../model/ink-format";
import { fnv1a } from "../util/hash";

/** Rohe Bounding-Box der Punkte (ohne Strichbreite). */
export interface Box {
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
}

/** Ein zusammenhängendes Stück einer Zeile, das als ein Bild erkannt wird. */
export interface Segment {
	strokes: Stroke[];
	box: Box;
	/** Cache-Schlüssel: Hash der (unveränderlichen) Stroke-IDs. */
	key: string;
}

export interface SegmentOptions {
	/** Max. Breite/Höhe eines Segments, bevor es geteilt wird (Modell-Maximalbreite). */
	maxAspect: number;
	/**
	 * Horizontale Lücke in Zeilenhöhen, ab der ein neues Segment beginnt – z. B. getrennte Antwortfelder.
	 * Bezug ist die Zeilenhöhe, nicht die Strichhöhe: Druckbuchstaben bestehen aus kurzen Strichen,
	 * Wortabstände sollen im Segment bleiben (das Modell erkennt Leerzeichen selbst).
	 */
	gapFactor: number;
}

const DEFAULTS: SegmentOptions = { maxAspect: 16, gapFactor: 1.5 };

export function boxOf(strokes: Stroke[]): Box {
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	for (const s of strokes) {
		const p = s.points;
		for (let i = 0; i < p.length; i += 3) {
			if (p[i] < minX) minX = p[i];
			if (p[i] > maxX) maxX = p[i];
			if (p[i + 1] < minY) minY = p[i + 1];
			if (p[i + 1] > maxY) maxY = p[i + 1];
		}
	}
	return { minX, minY, maxX, maxY };
}

const height = (b: Box) => b.maxY - b.minY;
const median = (xs: number[]) => {
	const s = [...xs].sort((a, b) => a - b);
	return s.length ? s[Math.floor(s.length / 2)] : 0;
};

function makeSegment(strokes: Stroke[]): Segment {
	return { strokes, box: boxOf(strokes), key: fnv1a(strokes.map((s) => s.id).sort().join(",")) };
}

/** Typische Höhe eines Buchstabens/Wortteils – Bezug für Zeilenabstand, Lücken und Rastergröße. */
export function referenceHeight(strokes: Stroke[]): number {
	const heights = strokes.map((s) => height(boxOf([s]))).filter((h) => h > 0);
	if (!heights.length) return 10;
	const sorted = [...heights].sort((a, b) => a - b);
	// Pünktchen und Kommas (unteres Viertel) nicht mitzählen
	return Math.max(4, median(sorted.slice(Math.floor(sorted.length / 4))));
}

interface Line {
	strokes: Stroke[];
	minY: number;
	maxY: number;
}

/** Striche → Zeilen (oben nach unten) → Segmente (links nach rechts). Nur Stift, kein Textmarker. */
export function segmentLines(all: Stroke[], options: Partial<SegmentOptions> = {}): Segment[][] {
	const opts = { ...DEFAULTS, ...options };
	const strokes = all.filter((s) => s.tool === "pen" && !s.shape && s.points.length);
	if (!strokes.length) return [];
	const H = referenceHeight(strokes);
	const boxes = new Map(strokes.map((s) => [s, boxOf([s])]));
	const isSmall = (s: Stroke) => height(boxes.get(s)!) < 0.3 * H && boxes.get(s)!.maxX - boxes.get(s)!.minX < 0.6 * H;
	const cy = (b: Box) => (b.minY + b.maxY) / 2;

	const lines: Line[] = [];
	const big = strokes.filter((s) => !isSmall(s)).sort((a, b) => cy(boxes.get(a)!) - cy(boxes.get(b)!));
	for (const s of big) {
		const b = boxes.get(s)!;
		let best: Line | null = null;
		let bestScore = 0;
		for (const line of lines) {
			const overlap = Math.min(b.maxY, line.maxY) - Math.max(b.minY, line.minY);
			const ratio = overlap / Math.max(1e-6, Math.min(height(b), line.maxY - line.minY) || H);
			const close = Math.abs(cy(b) - (line.minY + line.maxY) / 2) < 0.5 * H;
			const score = Math.max(ratio, close ? 0.5 : 0);
			if (score >= 0.5 && score > bestScore) {
				best = line;
				bestScore = score;
			}
		}
		if (best) {
			best.strokes.push(s);
			best.minY = Math.min(best.minY, b.minY);
			best.maxY = Math.max(best.maxY, b.maxY);
		} else {
			lines.push({ strokes: [s], minY: b.minY, maxY: b.maxY });
		}
	}

	// Kleine Striche (i-Punkte, Umlaut-Punkte, Kommas) zur nächstgelegenen Zeile; bei Gleichstand die untere.
	for (const s of strokes.filter(isSmall)) {
		const y = cy(boxes.get(s)!);
		if (!lines.length) {
			lines.push({ strokes: [s], minY: y, maxY: y });
			continue;
		}
		let best = lines[0];
		let bestDist = Infinity;
		for (const line of lines) {
			const d = y < line.minY ? line.minY - y : y > line.maxY ? (y - line.maxY) * 1.5 : 0;
			if (d < bestDist || (d === bestDist && line.minY > best.minY)) {
				best = line;
				bestDist = d;
			}
		}
		best.strokes.push(s);
	}

	lines.sort((a, b) => a.minY - b.minY);
	return lines.map((line) => splitLine(line.strokes, boxes, Math.max(H, line.maxY - line.minY), opts));
}

function splitLine(strokes: Stroke[], boxes: Map<Stroke, Box>, lineHeight: number, opts: SegmentOptions): Segment[] {
	const sorted = [...strokes].sort((a, b) => boxes.get(a)!.minX - boxes.get(b)!.minX);
	const groups: Stroke[][] = [];
	let current: Stroke[] = [];
	let right = -Infinity;
	for (const s of sorted) {
		const b = boxes.get(s)!;
		if (current.length && b.minX - right > opts.gapFactor * lineHeight) {
			groups.push(current);
			current = [];
			right = -Infinity;
		}
		current.push(s);
		right = Math.max(right, b.maxX);
	}
	if (current.length) groups.push(current);
	return groups.flatMap((g) => splitWide(g, boxes, lineHeight, opts));
}

/** Zu breite Segmente an der größten Lücke nahe der Mitte teilen (rekursiv). */
function splitWide(strokes: Stroke[], boxes: Map<Stroke, Box>, H: number, opts: SegmentOptions): Segment[] {
	const seg = makeSegment(strokes);
	const h = Math.max(height(seg.box), H);
	if ((seg.box.maxX - seg.box.minX) / h <= opts.maxAspect || strokes.length < 2) return [seg];
	const sorted = [...strokes].sort((a, b) => boxes.get(a)!.minX - boxes.get(b)!.minX);
	const mid = (seg.box.minX + seg.box.maxX) / 2;
	const width = seg.box.maxX - seg.box.minX;
	let bestIdx = Math.floor(sorted.length / 2);
	let bestScore = -Infinity;
	let right = boxes.get(sorted[0])!.maxX;
	for (let i = 1; i < sorted.length; i++) {
		const left = boxes.get(sorted[i])!.minX;
		const gap = left - right;
		const score = gap - (Math.abs(left - mid) / width) * H; // Lücke groß, nahe der Mitte
		if (score > bestScore) {
			bestScore = score;
			bestIdx = i;
		}
		right = Math.max(right, boxes.get(sorted[i])!.maxX);
	}
	return [
		...splitWide(sorted.slice(0, bestIdx), boxes, H, opts),
		...splitWide(sorted.slice(bestIdx), boxes, H, opts),
	];
}
