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

// ---- Formerkennung ----

export type ShapeKind = "line" | "rect" | "triangle" | "ellipse";

export interface Shape {
	kind: ShapeKind;
	points: number[];
}

/** Kleiner als das (Doc-Einheiten, etwa eine Zeilenhöhe) wird nichts erkannt – Buchstaben bleiben Buchstaben. */
export const SHAPE_MIN_SIZE = 30;
/** Linien und Rechtecke rasten so nah (Grad) an Waagerechte/Senkrechte ein. */
const SNAP_AXIS_DEG = 6;
const RECT_AXIS_DEG = 10;

type Pt = [number, number];

function toPts(points: number[]): Pt[] {
	const out: Pt[] = [];
	for (let i = 0; i < points.length; i += 3) out.push([points[i], points[i + 1]]);
	return out;
}

function dist(a: Pt, b: Pt): number {
	return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

/** Abstand von p zur Geraden durch a und b (bei a = b zum Punkt a). */
function lineDistance(p: Pt, a: Pt, b: Pt): number {
	const len = dist(a, b);
	if (len === 0) return dist(p, a);
	return Math.abs((b[0] - a[0]) * (a[1] - p[1]) - (a[0] - p[0]) * (b[1] - a[1])) / len;
}

/** Ramer–Douglas–Peucker: Eckpunkte einer Polylinie. */
function simplify(pts: Pt[], eps: number): Pt[] {
	const keep = new Array<boolean>(pts.length).fill(false);
	keep[0] = keep[pts.length - 1] = true;
	const stack: [number, number][] = [[0, pts.length - 1]];
	while (stack.length) {
		const [s, e] = stack.pop() as [number, number];
		let best = -1;
		let bestD = eps;
		for (let i = s + 1; i < e; i++) {
			const d = lineDistance(pts[i], pts[s], pts[e]);
			if (d > bestD) {
				bestD = d;
				best = i;
			}
		}
		if (best < 0) continue;
		keep[best] = true;
		stack.push([s, best], [best, e]);
	}
	return pts.filter((_, i) => keep[i]);
}

/** Innenwinkel bei b (Grad, 180 = gerade). */
function angleAt(a: Pt, b: Pt, c: Pt): number {
	const v1 = Math.atan2(a[1] - b[1], a[0] - b[0]);
	const v2 = Math.atan2(c[1] - b[1], c[0] - b[0]);
	let d = Math.abs(((v1 - v2) * 180) / Math.PI);
	if (d > 180) d = 360 - d;
	return d;
}

/** Ecken eines geschlossenen Zugs: fast gerade Stellen (z. B. der Startpunkt mitten auf einer Kante) fallen weg. */
function closedCorners(pts: Pt[], eps: number, mergeDist: number): Pt[] {
	let corners = simplify(pts, eps);
	if (corners.length > 1 && dist(corners[0], corners[corners.length - 1]) < mergeDist) corners.pop();
	let changed = true;
	while (changed && corners.length > 2) {
		changed = false;
		for (let i = 0; i < corners.length; i++) {
			const prev = corners[(i + corners.length - 1) % corners.length];
			const next = corners[(i + 1) % corners.length];
			if (angleAt(prev, corners[i], next) > 150 || dist(prev, corners[i]) < mergeDist) {
				corners = corners.filter((_, j) => j !== i);
				changed = true;
				break;
			}
		}
	}
	return corners;
}

function axisAngle(a: Pt, b: Pt): number {
	const deg = Math.abs((Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI) % 90;
	return Math.min(deg, 90 - deg);
}

function ellipse(cx: number, cy: number, rx: number, ry: number): number[] {
	const n = 72;
	const corners: Pt[] = [];
	for (let i = 0; i < n; i++) {
		const t = (i / n) * Math.PI * 2;
		corners.push([cx + rx * Math.cos(t), cy + ry * Math.sin(t)]);
	}
	return polyline(corners, true);
}

/**
 * Erkennt Linie, Rechteck, Dreieck oder Ellipse/Kreis in einem Freihand-Strich und liefert saubere Punkte
 * (konstanter Druck). `null`, wenn nichts davon passt – der Strich bleibt dann, wie er ist.
 */
export function recognizeShape(points: number[]): Shape | null {
	const pts = toPts(points);
	if (pts.length < 4) return null;
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	let length = 0;
	pts.forEach((p, i) => {
		minX = Math.min(minX, p[0]);
		maxX = Math.max(maxX, p[0]);
		minY = Math.min(minY, p[1]);
		maxY = Math.max(maxY, p[1]);
		if (i) length += dist(pts[i - 1], p);
	});
	const w = maxX - minX;
	const h = maxY - minY;
	const diag = Math.hypot(w, h);
	if (diag < SHAPE_MIN_SIZE) return null;
	const start = pts[0];
	const end = pts[pts.length - 1];
	const chord = dist(start, end);

	// Linie: kaum Abweichung von der Sehne, kein Hin und Her.
	if (chord >= SHAPE_MIN_SIZE && length <= chord * 1.2) {
		const dev = Math.max(...pts.map((p) => lineDistance(p, start, end)));
		if (dev <= Math.max(2, chord * 0.08)) {
			let [x1, y1] = end;
			const a = axisAngle(start, end);
			if (a <= SNAP_AXIS_DEG) {
				if (Math.abs(x1 - start[0]) >= Math.abs(y1 - start[1])) y1 = start[1];
				else x1 = start[0];
			}
			return { kind: "line", points: polyline([start, [x1, y1]], false) };
		}
	}

	// Geschlossene Formen: Ende nahe am Anfang, Umfang deutlich größer als die Diagonale.
	if (chord > Math.max(0.25 * diag, 8) || length < 1.8 * diag) return null;
	const cx = (minX + maxX) / 2;
	const cy = (minY + maxY) / 2;
	const rx = w / 2;
	const ry = h / 2;
	if (Math.min(rx, ry) < 0.12 * Math.max(rx, ry)) return null;
	const radii = pts.map((p) => Math.hypot((p[0] - cx) / rx, (p[1] - cy) / ry));
	const mean = radii.reduce((s, r) => s + r, 0) / radii.length;
	const cv = Math.sqrt(radii.reduce((s, r) => s + (r - mean) ** 2, 0) / radii.length) / mean;
	const round = (): Shape => {
		// Fast gleiche Radien → Kreis.
		if (Math.abs(rx - ry) / Math.max(rx, ry) < 0.12) {
			const r = (rx + ry) / 2;
			return { kind: "ellipse", points: ellipse(cx, cy, r, r) };
		}
		return { kind: "ellipse", points: ellipse(cx, cy, rx, ry) };
	};
	if (cv < 0.07) return round();

	const corners = closedCorners(pts, 0.08 * diag, 0.15 * diag);
	if (corners.length === 3) return { kind: "triangle", points: polyline(corners, true) };
	if (corners.length === 4) {
		const angles = corners.map((c, i) => angleAt(corners[(i + 3) % 4], c, corners[(i + 1) % 4]));
		if (angles.every((a) => a >= 60 && a <= 120)) {
			const axis = corners.every((c, i) => axisAngle(c, corners[(i + 1) % 4]) <= RECT_AXIS_DEG);
			const rect: Pt[] = axis
				? [[minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY]]
				: corners;
			return { kind: "rect", points: polyline(rect, true) };
		}
	}
	if (cv < 0.12) return round();
	return null;
}
