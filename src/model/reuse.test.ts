import { describe, expect, it } from "vitest";
import { createNotebook, decodeInk, encodeInk, type Stroke } from "./ink-format";
import { reuseStrokes, sameStroke } from "./reuse";

const stroke = (id: string, extra: Partial<Stroke> = {}): Stroke => ({
	id,
	tool: "pen",
	color: 0,
	size: 3,
	// ungerundet wie direkt aus der Eingabe
	points: [10.123456, 20.987654, 0.4321, 11.55555, 22.44444, 0.61234, 13.0001, 25.9999, 0.9],
	...extra,
});

describe("reuseStrokes", () => {
	it("übernimmt die bekannten Objekte nach dem Weg durch die Datei (Quantisierung)", () => {
		const doc = createNotebook("r");
		doc.strokes = [stroke("a"), stroke("b", { simulated: true }), stroke("c", { tool: "hl", color: "#40c057", size: 12 })];
		const reloaded = decodeInk(encodeInk(doc));
		expect(reloaded.strokes[0]).not.toBe(doc.strokes[0]);
		reuseStrokes(doc.strokes, reloaded);
		reloaded.strokes.forEach((s, i) => expect(s).toBe(doc.strokes[i]));
	});

	it("neue und geänderte Striche bleiben die frisch gelesenen", () => {
		const known = [stroke("a"), stroke("b"), stroke("c"), stroke("d"), stroke("e"), stroke("f")];
		const fresh = [
			stroke("a", { points: [10.2, 21, 0.43, 11.6, 22.4, 0.61, 13, 26, 0.9] }), // Punkt um 0,08 verschoben
			stroke("b", { color: 1 }),
			stroke("c", { size: 4 }),
			stroke("d", { shape: true }),
			stroke("e", { points: [10.1, 21, 0.43] }),
			stroke("neu"),
		];
		const doc = { ...createNotebook("r"), strokes: fresh.slice() };
		reuseStrokes(known, doc);
		doc.strokes.forEach((s, i) => expect(s).toBe(fresh[i]));
	});

	it("Druck außerhalb 0..1 (in der Datei gekappt) gilt als geändert", () => {
		const a = stroke("a", { points: [1, 2, 1.2] });
		const b = stroke("a", { points: [1, 2, 1] });
		expect(sameStroke(a, b)).toBe(false);
	});
});
