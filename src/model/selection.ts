import type { Stroke } from "./ink-format";
import { strokeBounds, unionBounds, type Bounds } from "./ops";

/**
 * Lasso-Auswahl: welche Striche ein Freihand-Polygon einschließt, und wie ausgewählte Striche verschoben,
 * skaliert oder umgefärbt werden. Striche sind unveränderlich – Transformationen liefern Kopien mit neuer ID.
 */

/** So viel Anteil der Punkte eines Strichs muss im Lasso liegen. */
export const LASSO_COVER = 0.6;

/** Punkt im Polygon (flach `[x, y, x, y, …]`), Even-odd-Regel. */
export function pointInPolygon(x: number, y: number, poly: number[]): boolean {
	let inside = false;
	const n = poly.length;
	for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
		const xi = poly[i];
		const yi = poly[i + 1];
		const xj = poly[j];
		const yj = poly[j + 1];
		if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
	}
	return inside;
}

function polyBounds(poly: number[]): Bounds {
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	for (let i = 0; i < poly.length; i += 2) {
		minX = Math.min(minX, poly[i]);
		maxX = Math.max(maxX, poly[i]);
		minY = Math.min(minY, poly[i + 1]);
		maxY = Math.max(maxY, poly[i + 1]);
	}
	return { minX, minY, maxX, maxY };
}

/** IDs der Striche, die das (geschlossen gedachte) Lasso zu mindestens LASSO_COVER einschließt. */
export function lassoSelect(strokes: Stroke[], poly: number[], cover = LASSO_COVER): string[] {
	if (poly.length < 6) return [];
	const pb = polyBounds(poly);
	const out: string[] = [];
	for (const s of strokes) {
		const b = strokeBounds(s);
		if (b.maxX < pb.minX || b.minX > pb.maxX || b.maxY < pb.minY || b.minY > pb.maxY) continue;
		const p = s.points;
		const n = p.length / 3;
		if (!n) continue;
		// Lange Striche: jeden k-ten Punkt prüfen, das reicht für den Anteil.
		const step = Math.max(1, Math.floor(n / 64));
		let inside = 0;
		let total = 0;
		for (let i = 0; i < n; i += step) {
			total++;
			if (pointInPolygon(p[i * 3], p[i * 3 + 1], poly)) inside++;
		}
		if (inside / total >= cover) out.push(s.id);
	}
	return out;
}

/** Umrandung der Auswahl (inkl. Strichbreite). */
export function selectionBounds(strokes: Stroke[]): Bounds | null {
	return unionBounds(strokes.map(strokeBounds));
}

/** Verschieben um (dx, dy) und gleichmäßig skalieren um `scale` mit Ursprung (ox, oy). */
export interface Transform {
	dx: number;
	dy: number;
	scale: number;
	ox: number;
	oy: number;
}

export const IDENTITY: Transform = { dx: 0, dy: 0, scale: 1, ox: 0, oy: 0 };

export function isIdentity(t: Transform): boolean {
	return t.dx === 0 && t.dy === 0 && t.scale === 1;
}

export function transformPoint(t: Transform, x: number, y: number): [number, number] {
	return [t.ox + (x - t.ox) * t.scale + t.dx, t.oy + (y - t.oy) * t.scale + t.dy];
}

export function transformBounds(t: Transform, b: Bounds): Bounds {
	const [minX, minY] = transformPoint(t, b.minX, b.minY);
	const [maxX, maxY] = transformPoint(t, b.maxX, b.maxY);
	return { minX, minY, maxX, maxY };
}

/** Kopie des Strichs mit neuer ID; die Strichbreite wächst mit. */
export function transformStroke(s: Stroke, t: Transform, id: string): Stroke {
	const p = s.points.slice();
	for (let i = 0; i < p.length; i += 3) [p[i], p[i + 1]] = transformPoint(t, p[i], p[i + 1]);
	return { ...s, id, size: round2(s.size * t.scale), points: p };
}

export function recolorStroke(s: Stroke, color: Stroke["color"], id: string): Stroke {
	return { ...s, id, points: s.points.slice(), color };
}

const round2 = (v: number) => Math.round(v * 100) / 100;

/**
 * Verschiebung so begrenzen, dass die Auswahl nicht aus der Fläche fällt: links/rechts/oben immer,
 * unten nur auf Arbeitsblättern (das Heft wächst mit).
 */
export function clampMove(b: Bounds, dx: number, dy: number, w: number, h: number | null): [number, number] {
	const width = b.maxX - b.minX;
	const height = b.maxY - b.minY;
	const minDx = -b.minX;
	const maxDx = Math.max(minDx, w - width - b.minX);
	let x = Math.min(maxDx, Math.max(minDx, dx));
	if (width > w) x = minDx;
	const minDy = -b.minY;
	let y = Math.max(minDy, dy);
	if (h !== null) y = Math.min(Math.max(minDy, h - height - b.minY), y);
	return [x, y];
}

/** Heft-Modus: kommt etwas näher als GROW_MARGIN an den unteren Rand, wächst die Fläche um GROW_STEP. */
export const GROW_MARGIN = 120;
export const GROW_STEP = 300;

/** Höhe, die ein Heft braucht, damit `bottom` (Doc-Einheiten) nicht am Rand klebt. Schrumpft nie. */
export function grownHeight(h: number, bottom: number): number {
	let out = h;
	while (bottom >= out - GROW_MARGIN) out += GROW_STEP;
	return out;
}
