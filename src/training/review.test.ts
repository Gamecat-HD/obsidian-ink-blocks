import { describe, expect, it } from "vitest";
import type { Stroke } from "../model/ink-format";
import { segmentLines } from "../ocr/segment";
import { assignStrokes, reviewItems, segmentText, wordAlternatives } from "./review";

const stroke = (id: string, x0: number, x1: number, y0 = 0, y1 = 20): Stroke => ({ id, tool: "pen", color: 0, size: 3, points: [x0, y0, 0.5, x1, y1, 0.5] });

describe("assignStrokes", () => {
	it("nach Strichmitte, Rest ans letzte Wort", () => {
		const parts = assignStrokes([stroke("a", 0, 10), stroke("b", 40, 60), stroke("c", 200, 210)], [{ x0: 0, x1: 30 }, { x0: 30, x1: 100 }]);
		expect(parts.map((p) => p.map((s) => s.id))).toEqual([["a"], ["b", "c"]]);
	});
});

describe("wordAlternatives", () => {
	it("nur Lesarten mit gleicher Wortzahl, je Wort ohne Doppelte", () => {
		expect(wordAlternatives("Hallo Welt", ["Hallo Wert", "Halle Welt", "Hallo", "Hallo Wert"])).toEqual([["Halle"], ["Wert"]]);
	});
});

describe("reviewItems", () => {
	const strokes = [stroke("a", 0, 30), stroke("b", 35, 60), stroke("c", 75, 110)];
	const [seg] = segmentLines(strokes).flat();

	it("ein Eintrag je Wort mit seinen Strichen und gemeinsamem Segment", () => {
		const items = reviewItems("x.ink", seg, {
			text: "ab c",
			confidence: 0.9,
			ms: 0,
			words: [{ text: "ab", conf: 0.4, x0: 0, x1: 68 }, { text: "c", conf: 0.95, x0: 80, x1: 110 }],
			alts: ["ob c"],
		});
		expect(items.map((i) => [i.word, i.strokes.map((s) => s.id), i.alts])).toEqual([["ab", ["a", "b"], ["ob"]], ["c", ["c"], []]]);
		expect(items[0].seg).toBe(items[1].seg);
		items[0].seg.words[0] = "AB";
		items[1].seg.words[1] = "";
		expect(segmentText(items[0].seg)).toBe("AB");
	});

	it("ohne passende Wörter: das ganze Segment", () => {
		const items = reviewItems("x.ink", seg, { text: "ab c", confidence: 0.5, ms: 0 });
		expect(items).toHaveLength(1);
		expect(items[0].strokes).toHaveLength(3);
	});
});
