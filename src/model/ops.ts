import type { InkData, Stroke } from "./ink-format";

/** Änderungen am Dokument. Striche sind unveränderlich; Ops sind invertierbar (Undo/Redo). */
export type InkOp =
	| { kind: "add"; stroke: Stroke; hBefore: number; hAfter: number }
	| { kind: "erase"; removed: { stroke: Stroke; index: number }[] }
	/**
	 * Striche ersetzen (Lasso verschieben/skalieren/umfärben, Einfügen, präzises Radieren): `removed` raus,
	 * `added` als Block an Index `at` (nach dem Entfernen) hinein. Neue Striche bekommen neue IDs.
	 */
	| { kind: "replace"; removed: { stroke: Stroke; index: number }[]; added: Stroke[]; at: number; hBefore: number; hAfter: number };

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

function removeIds(doc: InkData, ids: Set<string>) {
	doc.strokes = doc.strokes.filter((s) => !ids.has(s.id));
}

/** In ursprünglicher Reihenfolge wieder einsetzen (aufsteigende Indizes). */
function restore(doc: InkData, removed: { stroke: Stroke; index: number }[]) {
	for (const { stroke, index } of [...removed].sort((a, b) => a.index - b.index)) {
		doc.strokes.splice(Math.min(index, doc.strokes.length), 0, stroke);
	}
}

export function applyOp(doc: InkData, op: InkOp) {
	if (op.kind === "add") {
		doc.strokes.push(op.stroke);
		doc.h = op.hAfter;
	} else if (op.kind === "erase") {
		removeIds(doc, new Set(op.removed.map((r) => r.stroke.id)));
	} else {
		removeIds(doc, new Set(op.removed.map((r) => r.stroke.id)));
		doc.strokes.splice(Math.min(op.at, doc.strokes.length), 0, ...op.added);
		doc.h = op.hAfter;
	}
}

export function invertOp(doc: InkData, op: InkOp) {
	if (op.kind === "add") {
		doc.strokes = doc.strokes.filter((s) => s.id !== op.stroke.id);
		doc.h = op.hBefore;
	} else if (op.kind === "erase") {
		restore(doc, op.removed);
	} else {
		removeIds(doc, new Set(op.added.map((s) => s.id)));
		restore(doc, op.removed);
		doc.h = op.hBefore;
	}
}

/**
 * Ersetzen als Op: Die neuen Striche kommen dorthin, wo der erste entfernte stand (Stapelreihenfolge
 * bleibt ungefähr erhalten), ohne entfernte Striche ans Ende.
 */
export function replaceOp(doc: InkData, removedIds: Set<string>, added: Stroke[], hAfter = doc.h): Extract<InkOp, { kind: "replace" }> {
	const removed: { stroke: Stroke; index: number }[] = [];
	doc.strokes.forEach((stroke, index) => removedIds.has(stroke.id) && removed.push({ stroke, index }));
	const at = removed.length ? removed[0].index : doc.strokes.length;
	return { kind: "replace", removed, added, at, hBefore: doc.h, hAfter };
}

/** Bereiche, die nach einer Op neu gezeichnet werden müssen. */
export function opBounds(op: InkOp): Bounds[] {
	if (op.kind === "add") return [strokeBounds(op.stroke)];
	const out = op.removed.map((r) => strokeBounds(r.stroke));
	if (op.kind === "replace") for (const s of op.added) out.push(strokeBounds(s));
	return out;
}

export function unionBounds(list: Bounds[]): Bounds | null {
	if (!list.length) return null;
	const b = { ...list[0] };
	for (const o of list) {
		if (o.minX < b.minX) b.minX = o.minX;
		if (o.minY < b.minY) b.minY = o.minY;
		if (o.maxX > b.maxX) b.maxX = o.maxX;
		if (o.maxY > b.maxY) b.maxY = o.maxY;
	}
	return b;
}
