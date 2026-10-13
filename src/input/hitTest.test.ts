import { describe, expect, it } from "vitest";
import { createNotebook, type Stroke } from "../model/ink-format";
import { applyOp, invertOp, strokeBounds, type InkOp } from "../model/ops";
import { tileLayout, tilesForBounds } from "../render/transform";
import { svgPathFromOutline } from "../render/svgPath";
import { eraserHits, pointSegmentDistance, segmentDistance } from "./hitTest";

const stroke = (id: string, points: number[], size = 4): Stroke => ({ id, tool: "pen", color: 0, size, points });

describe("Geometrie", () => {
	it("pointSegmentDistance", () => {
		expect(pointSegmentDistance(5, 5, 0, 0, 10, 0)).toBe(5);
		expect(pointSegmentDistance(-3, 4, 0, 0, 10, 0)).toBe(5);
		expect(pointSegmentDistance(1, 1, 2, 2, 2, 2)).toBeCloseTo(Math.SQRT2);
	});
	it("segmentDistance erkennt Kreuzungen und Abstände", () => {
		expect(segmentDistance(0, 0, 10, 10, 0, 10, 10, 0)).toBe(0);
		expect(segmentDistance(0, 0, 10, 0, 0, 3, 10, 3)).toBe(3);
	});
});

describe("eraserHits", () => {
	const s = stroke("a", [0, 0, 0.5, 100, 0, 0.5]);
	it("trifft innerhalb von Radius + halber Strichbreite", () => {
		expect(eraserHits(s, 50, 9, 60, 9, 7)).toBe(true); // 9 ≤ 7 + 2
		expect(eraserHits(s, 50, 10, 60, 10, 7)).toBe(false);
	});
	it("trifft beim Durchqueren, auch wenn kein Punkt nahe liegt", () => {
		expect(eraserHits(s, 50, -50, 50, 50, 1)).toBe(true);
	});
	it("Ein-Punkt-Striche (Pünktchen)", () => {
		expect(eraserHits(stroke("dot", [10, 10, 0.5]), 0, 12, 20, 12, 1)).toBe(true);
	});
	it("Bounding-Box-Vorfilter", () => {
		expect(eraserHits(s, 500, 500, 600, 600, 5)).toBe(false);
	});
});

describe("Ops", () => {
	it("add/erase sind invertierbar und erhalten die Reihenfolge", () => {
		const doc = createNotebook("x");
		const [a, b, c] = ["a", "b", "c"].map((id, i) => stroke(id, [i, i, 0.5]));
		doc.strokes.push(a, b);
		const add: InkOp = { kind: "add", stroke: c, hBefore: 400, hAfter: 700 };
		applyOp(doc, add);
		expect(doc.strokes.map((s) => s.id)).toEqual(["a", "b", "c"]);
		expect(doc.h).toBe(700);
		const erase: InkOp = { kind: "erase", removed: [{ stroke: a, index: 0 }, { stroke: c, index: 2 }] };
		applyOp(doc, erase);
		expect(doc.strokes.map((s) => s.id)).toEqual(["b"]);
		invertOp(doc, erase);
		expect(doc.strokes.map((s) => s.id)).toEqual(["a", "b", "c"]);
		invertOp(doc, add);
		expect(doc.strokes.map((s) => s.id)).toEqual(["a", "b"]);
		expect(doc.h).toBe(400);
	});
	it("strokeBounds enthält die halbe Strichbreite", () => {
		expect(strokeBounds(stroke("b", [10, 20, 0.5, 30, 5, 0.5], 4))).toEqual({ minX: 7, minY: 2, maxX: 33, maxY: 23 });
	});
});

describe("Kacheln", () => {
	it("teilt die Höhe in Kacheln", () => {
		expect(tileLayout(2500, 1024)).toEqual([
			{ top: 0, height: 1024 },
			{ top: 1024, height: 1024 },
			{ top: 2048, height: 452 },
		]);
	});
	it("findet berührte Kacheln (Bounds in Doc-Einheiten, Scale 0.5)", () => {
		const tiles = tileLayout(3000, 1024);
		expect(tilesForBounds({ minX: 0, minY: 1900, maxX: 10, maxY: 2200 }, 0.5, tiles)).toEqual([0, 1]);
		expect(tilesForBounds({ minX: 0, minY: 10, maxX: 10, maxY: 20 }, 0.5, tiles)).toEqual([0]);
	});
});

describe("svgPathFromOutline", () => {
	it("braucht mindestens 4 Punkte", () => {
		expect(svgPathFromOutline([[0, 0], [1, 1], [2, 2]])).toBe("");
		expect(svgPathFromOutline([[0, 0], [1, 0], [1, 1], [0, 1]])).toMatch(/^M0\.00,0\.00 Q1\.00,0\.00 1\.00,0\.50 T0\.50,1\.00 Z$/);
	});
});

describe("Radieren in mehreren Schritten", () => {
	it("Undo stellt die Reihenfolge mit Original-Indizes wieder her", () => {
		const doc = createNotebook("x");
		doc.strokes = ["a", "b", "c", "d", "e"].map((id, i) => stroke(id, [i, i, 0.5]));
		const orig = new Map(doc.strokes.map((s, i) => [s.id, i]));
		const step1 = doc.strokes.filter((s) => s.id === "d").map((s) => ({ stroke: s, index: orig.get(s.id)! }));
		applyOp(doc, { kind: "erase", removed: step1 });
		const step2 = doc.strokes.filter((s) => s.id === "b" || s.id === "e").map((s) => ({ stroke: s, index: orig.get(s.id)! }));
		applyOp(doc, { kind: "erase", removed: step2 });
		expect(doc.strokes.map((s) => s.id)).toEqual(["a", "c"]);
		invertOp(doc, { kind: "erase", removed: [...step1, ...step2] });
		expect(doc.strokes.map((s) => s.id)).toEqual(["a", "b", "c", "d", "e"]);
	});
});
