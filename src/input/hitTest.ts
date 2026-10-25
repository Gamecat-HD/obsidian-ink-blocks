import type { Stroke } from "../model/ink-format";
import { strokeBounds } from "../model/ops";

/** Abstand Punkt → Strecke. */
export function pointSegmentDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
	const dx = bx - ax;
	const dy = by - ay;
	const len2 = dx * dx + dy * dy;
	const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
	return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function segmentsIntersect(
	ax: number, ay: number, bx: number, by: number,
	cx: number, cy: number, dx: number, dy: number,
): boolean {
	const d1 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx);
	const d2 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
	const d3 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
	const d4 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
	return d1 * d2 < 0 && d3 * d4 < 0;
}

/** Minimaler Abstand zweier Strecken. */
export function segmentDistance(
	ax: number, ay: number, bx: number, by: number,
	cx: number, cy: number, dx: number, dy: number,
): number {
	if (segmentsIntersect(ax, ay, bx, by, cx, cy, dx, dy)) return 0;
	return Math.min(
		pointSegmentDistance(ax, ay, cx, cy, dx, dy),
		pointSegmentDistance(bx, by, cx, cy, dx, dy),
		pointSegmentDistance(cx, cy, ax, ay, bx, by),
		pointSegmentDistance(dx, dy, ax, ay, bx, by),
	);
}

/** Trifft die Radierer-Strecke (x1,y1)→(x2,y2) mit Radius `radius` den Strich? */
export function eraserHits(stroke: Stroke, x1: number, y1: number, x2: number, y2: number, radius: number): boolean {
	const b = strokeBounds(stroke);
	if (
		Math.max(x1, x2) + radius < b.minX ||
		Math.min(x1, x2) - radius > b.maxX ||
		Math.max(y1, y2) + radius < b.minY ||
		Math.min(y1, y2) - radius > b.maxY
	) {
		return false;
	}
	const tolerance = radius + stroke.size / 2;
	const p = stroke.points;
	if (p.length === 3) return pointSegmentDistance(p[0], p[1], x1, y1, x2, y2) <= tolerance;
	for (let i = 3; i < p.length; i += 3) {
		if (segmentDistance(x1, y1, x2, y2, p[i - 3], p[i - 2], p[i], p[i + 1]) <= tolerance) return true;
	}
	return false;
}

/**
 * Präziser Radierer: teilt einen Strich dort, wo die Radierer-Strecke ihn berührt. Liefert die übrigen Stücke
 * (jeweils mit neuer ID aus `newId`) oder `null`, wenn der Strich nicht berührt wird. Lange Segmente werden
 * vorher verdichtet, damit auch Formen mit weit auseinanderliegenden Stützpunkten sauber getrennt werden.
 */
export function splitStroke(
	stroke: Stroke,
	x1: number, y1: number, x2: number, y2: number,
	radius: number,
	newId: () => string,
): Stroke[] | null {
	if (!eraserHits(stroke, x1, y1, x2, y2, radius)) return null;
	const tolerance = radius + stroke.size * 0.4;
	const p = densify(stroke.points, Math.max(0.5, radius / 2));
	const keep: boolean[] = [];
	let removedAny = false;
	for (let i = 0; i < p.length; i += 3) {
		const hit = pointSegmentDistance(p[i], p[i + 1], x1, y1, x2, y2) <= tolerance;
		keep.push(!hit);
		if (hit) removedAny = true;
	}
	if (!removedAny) return null;
	const pieces: Stroke[] = [];
	let run: number[] = [];
	const flush = () => {
		// Einzelne Restpunkte wären nur Krümel.
		if (run.length >= 6) pieces.push({ ...stroke, id: newId(), points: run });
		run = [];
	};
	keep.forEach((k, j) => {
		if (k) run.push(p[j * 3], p[j * 3 + 1], p[j * 3 + 2]);
		else flush();
	});
	flush();
	return pieces;
}

/** Zwischenpunkte einfügen, bis kein Segment länger als `step` ist (Druck linear interpoliert). */
export function densify(points: number[], step: number): number[] {
	const out: number[] = [];
	for (let i = 0; i < points.length; i += 3) {
		if (i > 0) {
			const [ax, ay, ap] = [points[i - 3], points[i - 2], points[i - 1]];
			const [bx, by, bp] = [points[i], points[i + 1], points[i + 2]];
			const n = Math.ceil(Math.hypot(bx - ax, by - ay) / step);
			for (let k = 1; k < n; k++) {
				const t = k / n;
				out.push(ax + (bx - ax) * t, ay + (by - ay) * t, ap + (bp - ap) * t);
			}
		}
		out.push(points[i], points[i + 1], points[i + 2]);
	}
	return out;
}
