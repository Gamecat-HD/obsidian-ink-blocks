import { describe, expect, it } from "vitest";
import { History } from "./history";
import { createNotebook, type Stroke } from "./ink-format";
import { applyOp, type InkOp } from "./ops";

const stroke = (id: string): Stroke => ({ id, tool: "pen", color: 0, size: 3, points: [0, 0, 0.5] });

function setup() {
	const doc = createNotebook("h");
	const history = new History(3);
	const add = (id: string, hAfter = doc.h) => {
		const op: InkOp = { kind: "add", stroke: stroke(id), hBefore: doc.h, hAfter };
		applyOp(doc, op);
		history.push(op);
	};
	const ids = () => doc.strokes.map((s) => s.id);
	return { doc, history, add, ids };
}

describe("History", () => {
	it("undo/redo in richtiger Reihenfolge, inkl. Höhe", () => {
		const { doc, history, add, ids } = setup();
		add("a");
		add("b", 700);
		expect(doc.h).toBe(700);
		expect(history.undo(doc)?.kind).toBe("add");
		expect(ids()).toEqual(["a"]);
		expect(doc.h).toBe(400);
		history.redo(doc);
		expect(ids()).toEqual(["a", "b"]);
		expect(doc.h).toBe(700);
	});
	it("neue Op verwirft Redo", () => {
		const { doc, history, add } = setup();
		add("a");
		history.undo(doc);
		expect(history.canRedo).toBe(true);
		add("b");
		expect(history.canRedo).toBe(false);
		expect(history.redo(doc)).toBeNull();
	});
	it("begrenzt die Tiefe", () => {
		const { doc, history, add, ids } = setup();
		["a", "b", "c", "d"].forEach((id) => add(id));
		while (history.undo(doc));
		expect(ids()).toEqual(["a"]);
	});
	it("Radieren rückgängig machen", () => {
		const { doc, history, add, ids } = setup();
		add("a");
		add("b");
		const op: InkOp = { kind: "erase", removed: [{ stroke: doc.strokes[0], index: 0 }] };
		applyOp(doc, op);
		history.push(op);
		expect(ids()).toEqual(["b"]);
		history.undo(doc);
		expect(ids()).toEqual(["a", "b"]);
	});
});
