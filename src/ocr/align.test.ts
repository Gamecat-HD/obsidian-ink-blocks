import { describe, expect, it } from "vitest";
import { alignWords, ctcAlign } from "./align";

const ALPHA = "ab ";
const C = ALPHA.length + 1;

/** Log-Wahrscheinlichkeiten aus einer Folge „wahrscheinlichster Klassen“ (0 = Blank). */
function frames(seq: number[], p = 0.9): Float32Array {
	const out = new Float32Array(seq.length * C);
	seq.forEach((k, t) => {
		for (let c = 0; c < C; c++) out[t * C + c] = Math.log(c === k ? p : (1 - p) / (C - 1));
	});
	return out;
}

describe("ctcAlign", () => {
	it("findet die Zeitschritte jedes Zeichens", () => {
		// _ a a _ b _
		const lp = frames([0, 1, 1, 0, 2, 0]);
		const chars = ctcAlign(lp, [1, 6, C], ALPHA, "ab");
		expect(chars?.map((c) => [c.start, c.end])).toEqual([[1, 3], [4, 5]]);
		expect(chars![0].prob).toBeCloseTo(0.9);
	});

	it("doppelte Buchstaben brauchen einen Blank dazwischen", () => {
		const lp = frames([1, 0, 1, 0]);
		expect(ctcAlign(lp, [1, 4, C], ALPHA, "aa")?.map((c) => c.start)).toEqual([0, 2]);
	});

	it("unbekanntes Zeichen oder zu wenige Schritte → null", () => {
		expect(ctcAlign(frames([1, 0]), [1, 2, C], ALPHA, "x")).toBeNull();
		expect(ctcAlign(frames([1]), [1, 1, C], ALPHA, "aa")).toBeNull();
	});
});

describe("alignWords", () => {
	it("teilt an der Mitte der Lücke und nimmt das unsicherste Zeichen als Konfidenz", () => {
		// a a _ _ ␣ _ b b → „a b“, Leerzeichen bei t = 4
		const lp = frames([1, 1, 0, 0, 3, 0, 2, 2]);
		const words = alignWords(lp, [1, 8, C], ALPHA, "a b");
		expect(words?.map((w) => w.text)).toEqual(["a", "b"]);
		expect(words![0].start).toBe(0);
		expect(words![1].end).toBe(8);
		// Grenze zwischen Ende von „a“ (2) und Anfang von „b“ (6)
		expect(words![0].end).toBe(4);
		expect(words![1].start).toBe(4);
		expect(words![0].conf).toBeCloseTo(0.9);
	});
});
