/**
 * Geometrie für saubere Striche: gerade Textmarker-Linien und Formerkennung.
 * Punkte sind flach `[x, y, p, …]` in Doc-Einheiten, wie in `Stroke.points`.
 */

/** Abstand der Stützpunkte erzeugter Linien (Doc-Einheiten) – perfect-freehand braucht mehr als 2 Punkte. */
const STEP = 4;
/** So nah an der Waagerechten (Grad) wird eine gerade Linie exakt waagerecht. */
export const SNAP_HORIZONTAL_DEG = 8;
const SHAPE_PRESSURE = 0.5;

/** Strecke a→b als dichte Punktfolge mit konstantem Druck (ohne doppelten Endpunkt). */
function segment(out: number[], ax: number, ay: number, bx: number, by: number, includeEnd: boolean) {
	const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / STEP));
	for (let i = 0; i < n + (includeEnd ? 1 : 0); i++) {
		const t = i / n;
		out.push(ax + (bx - ax) * t, ay + (by - ay) * t, SHAPE_PRESSURE);
	}
}

/** Polylinie durch die Ecken; `closed` hängt die erste Ecke wieder an. */
export function polyline(corners: [number, number][], closed: boolean): number[] {
	const out: number[] = [];
	const pts = closed ? [...corners, corners[0]] : corners;
	for (let i = 0; i < pts.length - 1; i++) segment(out, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], i === pts.length - 2);
	return out;
}

/** Gerade Linie vom Start zum aktuellen Punkt, nahe der Waagerechten exakt waagerecht (Lineal). */
export function straightLine(x0: number, y0: number, x1: number, y1: number, snapDeg = SNAP_HORIZONTAL_DEG): number[] {
	const angle = Math.abs((Math.atan2(y1 - y0, x1 - x0) * 180) / Math.PI);
	const horizontal = angle <= snapDeg || angle >= 180 - snapDeg;
	return polyline([[x0, y0], [x1, horizontal ? y0 : y1]], false);
}
