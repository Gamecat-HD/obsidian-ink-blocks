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

/** Bounding-Box inkl. halber Strichbreite (Doc-Einheiten). */
export function strokeBounds(stroke: Stroke): Bounds {
	let b = boundsCache.get(stroke);
	if (b) return b;
	const pad = stroke.size / 2 + 1;
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	const p = stroke.points;
	for (let i = 0; i < p.length; i += 3) {
		if (p[i] < minX) minX = p[i];
		if (p[i] > maxX) maxX = p[i];
		if (p[i + 1] < minY) minY = p[i + 1];
		if (p[i + 1] > maxY) maxY = p[i + 1];
	}
	b = { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
	boundsCache.set(stroke, b);
	return b;
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
