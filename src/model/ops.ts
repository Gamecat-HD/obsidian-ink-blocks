import type { InkData, Stroke } from "./ink-format";

/** Änderungen am Dokument. Striche sind unveränderlich; Ops sind invertierbar (Undo/Redo). */
export type InkOp =
	| { kind: "add"; stroke: Stroke; hBefore: number; hAfter: number }
	| { kind: "erase"; removed: { stroke: Stroke; index: number }[] };

export interface Bounds {
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
}

const boundsCache = new WeakMap<Stroke, Bounds>();

/** Bounding-Box inkl. Strichradius (Doc-Einheiten). */
export function strokeBounds(stroke: Stroke): Bounds {
	let b = boundsCache.get(stroke);
	if (!b) {
		b = pointsBounds(stroke.points, stroke.size);
		boundsCache.set(stroke, b);
	}
	return b;
}

/**
 * Bounding-Box flacher Punkte `[x, y, p, …]` inkl. Strichradius. perfect-freehand macht den Radius bei
 * vollem Druck bis zu 0,8 × `size` groß (thinning 0.6), nicht nur `size / 2`.
 */
export function pointsBounds(p: number[], size: number): Bounds {
	const pad = size * 0.8 + 1;
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	for (let i = 0; i < p.length; i += 3) {
		if (p[i] < minX) minX = p[i];
		if (p[i] > maxX) maxX = p[i];
		if (p[i + 1] < minY) minY = p[i + 1];
		if (p[i + 1] > maxY) maxY = p[i + 1];
	}
	return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
}

export function applyOp(doc: InkData, op: InkOp) {
	if (op.kind === "add") {
		doc.strokes.push(op.stroke);
		doc.h = op.hAfter;
	} else {
		const ids = new Set(op.removed.map((r) => r.stroke.id));
		doc.strokes = doc.strokes.filter((s) => !ids.has(s.id));
	}
}

export function invertOp(doc: InkData, op: InkOp) {
	if (op.kind === "add") {
		doc.strokes = doc.strokes.filter((s) => s.id !== op.stroke.id);
		doc.h = op.hBefore;
	} else {
		// In ursprünglicher Reihenfolge wieder einsetzen (aufsteigende Indizes).
		for (const { stroke, index } of [...op.removed].sort((a, b) => a.index - b.index)) {
			doc.strokes.splice(Math.min(index, doc.strokes.length), 0, stroke);
		}
	}
}

/** Bereiche, die nach einer Op neu gezeichnet werden müssen. */
export function opBounds(op: InkOp): Bounds[] {
	return op.kind === "add" ? [strokeBounds(op.stroke)] : op.removed.map((r) => strokeBounds(r.stroke));
}
