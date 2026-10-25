import { describe, expect, it } from "vitest";
import { createNotebook, type Stroke } from "./ink-format";
import { applyOp, invertOp, replaceOp } from "./ops";
import { clampMove, grownHeight, lassoSelect, pointInPolygon, recolorStroke, transformStroke } from "./selection";

const stroke = (id: string, pts: [number, number][], extra: Partial<Stroke> = {}): Stroke => ({
	id,
	tool: "pen",
	color: 0,
	size: 2,
	points: pts.flatMap(([x, y]) => [x, y, 0.5]),
	...extra,
});

const square = [0, 0, 100, 0, 100, 100, 0, 100];

describe("Lasso", () => {
	it("Punkt im Polygon", () => {
		expect(pointInPolygon(50, 50, square)).toBe(true);
		expect(pointInPolygon(150, 50, square)).toBe(false);
		// Konkav (U-Form): die Lücke liegt außen
		const u = [0, 0, 30, 0, 30, 70, 70, 70, 70, 0, 100, 0, 100, 100, 0, 100];
		expect(pointInPolygon(50, 30, u)).toBe(false);
		expect(pointInPolygon(50, 90, u)).toBe(true);
	});

	it("wählt Striche, die überwiegend drinliegen", () => {
		const strokes = [
			stroke("in", [[10, 10], [50, 50], [90, 90]]),
			stroke("halb", [[50, 50], [150, 50], [200, 50], [250, 50]]),
			stroke("aus", [[200, 200], [300, 300]]),
			stroke("punkt", [[20, 80]]),
		];
		expect(lassoSelect(strokes, square)).toEqual(["in", "punkt"]);
		// Zu wenige Lasso-Punkte → nichts
		expect(lassoSelect(strokes, [0, 0, 100, 100])).toEqual([]);
	});

	it("verschiebt und skaliert als Kopie mit neuer ID", () => {
		const s = stroke("a", [[10, 10], [20, 30]], { size: 3, shape: true });
		const t = transformStroke(s, { dx: 5, dy: -5, scale: 2, ox: 10, oy: 10 }, "b");
		expect(t.id).toBe("b");
		expect(t.points).toEqual([15, 5, 0.5, 35, 45, 0.5]);
		expect(t.size).toBe(6);
		expect(t.shape).toBe(true);
		expect(s.points).toEqual([10, 10, 0.5, 20, 30, 0.5]); // Original unverändert
		expect(recolorStroke(s, 2, "c")).toMatchObject({ id: "c", color: 2, size: 3 });
	});

	it("begrenzt Verschiebungen auf die Fläche", () => {
		const b = { minX: 10, minY: 10, maxX: 110, maxY: 60 };
		expect(clampMove(b, -50, -50, 1000, null)).toEqual([-10, -10]);
		expect(clampMove(b, 2000, 5000, 1000, null)).toEqual([890, 5000]);
		expect(clampMove(b, 0, 5000, 1000, 400)).toEqual([0, 340]);
	});
});

describe("replace-Op", () => {
	it("ersetzt an Ort und Stelle, Undo stellt die Reihenfolge wieder her", () => {
		const doc = createNotebook("d");
		doc.strokes = [stroke("a", [[0, 0]]), stroke("b", [[1, 1]]), stroke("c", [[2, 2]])];
		const op = replaceOp(doc, new Set(["b"]), [stroke("b2", [[5, 5]]), stroke("b3", [[6, 6]])], 900);
		applyOp(doc, op);
		expect(doc.strokes.map((s) => s.id)).toEqual(["a", "b2", "b3", "c"]);
		expect(doc.h).toBe(900);
		invertOp(doc, op);
		expect(doc.strokes.map((s) => s.id)).toEqual(["a", "b", "c"]);
		expect(doc.h).toBe(400);
	});

	it("ohne entfernte Striche (Einfügen) kommen die neuen nach oben", () => {
		const doc = createNotebook("d");
		doc.strokes = [stroke("a", [[0, 0]])];
		const op = replaceOp(doc, new Set(), [stroke("n", [[1, 1]])]);
		applyOp(doc, op);
		expect(doc.strokes.map((s) => s.id)).toEqual(["a", "n"]);
		invertOp(doc, op);
		expect(doc.strokes.map((s) => s.id)).toEqual(["a"]);
	});
});

describe("Wachsen", () => {
	it("wächst in Schritten, schrumpft nie", () => {
		expect(grownHeight(400, 100)).toBe(400);
		expect(grownHeight(400, 300)).toBe(700);
		expect(grownHeight(400, 900)).toBe(1300);
	});
});
