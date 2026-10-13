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
