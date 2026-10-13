import { describe, expect, it } from "vitest";
import { createNotebook, type InkData } from "./ink-format";
import { mergeInk } from "./merge";

function doc(ids: string[], h = 400): InkData {
	const d = createNotebook("m");
	d.h = h;
	d.strokes = ids.map((id) => ({ id, tool: "pen", color: 0, size: 3, points: [0, 0, 0.5] }));
	return d;
}
const ids = (d: InkData) => d.strokes.map((s) => s.id);

describe("mergeInk", () => {
	it("übernimmt Ergänzungen beider Seiten", () => {
		expect(ids(mergeInk(doc(["a"]), doc(["a", "l1"]), doc(["a", "r1"])))).toEqual(["a", "r1", "l1"]);
	});
	it("übernimmt Löschungen beider Seiten", () => {
		expect(ids(mergeInk(doc(["a", "b", "c"]), doc(["a", "c"]), doc(["a", "b"])))).toEqual(["a"]);
	});
	it("nimmt die größere Höhe", () => {
		expect(mergeInk(doc([], 400), doc([], 700), doc([], 500)).h).toBe(700);
	});
	it("ist idempotent, wenn eine Seite unverändert ist", () => {
		const base = doc(["a", "b"]);
		const remote = doc(["b", "x"]);
		expect(ids(mergeInk(base, base, remote))).toEqual(ids(remote));
	});
});
