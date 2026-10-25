/**
 * Abdeckband (wie in GoodNotes): ein gerades, deckendes Band vom ersten zum letzten Punkt, Enden wie
 * abgerissen. Pure Geometrie – die Lernplattform (src/lib/ink.ts) rechnet dasselbe.
 */

/** Zacken je Bandende. */
const TEETH = 4;

/** Umriss als Polygon `[[x, y], …]` (Doc-Einheiten). */
export function tapeOutline(points: number[], size: number): number[][] {
	const n = points.length;
	if (n < 3) return [];
	const ax = points[0];
	const ay = points[1];
	let bx = points[n - 3];
	let by = points[n - 2];
	let len = Math.hypot(bx - ax, by - ay);
	// Nur getippt: kurzes Stück in Schreibrichtung.
	if (len < size * 0.5) {
		bx = ax + size * 0.5;
		by = ay;
		len = size * 0.5;
	}
	const ux = (bx - ax) / len;
	const uy = (by - ay) / len;
	const nx = -uy;
	const ny = ux;
	const half = size / 2;
	const tooth = Math.min(size * 0.12, len / 4);
	const out: number[][] = [];
	const at = (cx: number, cy: number, along: number, across: number) => out.push([cx + ux * along + nx * across, cy + uy * along + ny * across]);
	// Oberkante a → b, Zacken am Ende b (von +half nach −half), Unterkante zurück, Zacken am Anfang a.
	at(ax, ay, 0, half);
	at(bx, by, 0, half);
	for (let i = 1; i <= TEETH * 2; i++) at(bx, by, i % 2 ? tooth : 0, half - (size * i) / (TEETH * 2));
	at(ax, ay, 0, -half);
	for (let i = 1; i < TEETH * 2; i++) at(ax, ay, i % 2 ? -tooth : 0, -half + (size * i) / (TEETH * 2));
	return out;
}

export function tapeSvg(points: number[], size: number): string {
	const poly = tapeOutline(points, size);
	if (!poly.length) return "";
	return `M${poly.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join("L")}Z`;
}

/** Liegt (x, y) auf dem Band? (Abstand zur Mittellinie ≤ halbe Breite.) */
export function tapeHit(points: number[], size: number, x: number, y: number): boolean {
	const n = points.length;
	if (n < 3) return false;
	const ax = points[0];
	const ay = points[1];
	const bx = points[n - 3];
	const by = points[n - 2];
	const dx = bx - ax;
	const dy = by - ay;
	const len2 = dx * dx + dy * dy;
	const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2));
	return Math.hypot(x - (ax + t * dx), y - (ay + t * dy)) <= size / 2;
}
