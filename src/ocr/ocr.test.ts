import { describe, expect, it } from "vitest";
import type { Stroke } from "../model/ink-format";
import { ctcGreedy } from "./ctc";
import { rasterTransform, toTensor, type HtrConfig } from "./preprocess";
import { boxOf, referenceHeight, segmentLines } from "./segment";

let n = 0;
/** Strich als Linie von (x0,y0) nach (x1,y1). */
const line = (x0: number, y0: number, x1: number, y1: number, tool: Stroke["tool"] = "pen"): Stroke => ({
	id: `s${n++}`,
	tool,
	color: 0,
	size: 3,
	points: [x0, y0, 0.5, (x0 + x1) / 2, (y0 + y1) / 2, 0.5, x1, y1, 0.5],
});
/** „Buchstabe“: senkrechter Strich der Höhe h bei x. */
const letter = (x: number, y: number, h = 30) => line(x, y, x + 4, y + h);
const dot = (x: number, y: number) => line(x, y, x + 1.5, y + 1.5);
const word = (x: number, y: number, count: number) => Array.from({ length: count }, (_, i) => letter(x + i * 14, y));
const ids = (segs: { strokes: Stroke[] }[]) => segs.map((s) => s.strokes.length);

describe("segmentLines", () => {
	it("trennt zwei Zeilen und sortiert sie von oben nach unten", () => {
		const lines = segmentLines([...word(50, 120, 5), ...word(50, 40, 4)]);
		expect(lines.map(ids)).toEqual([[4], [5]]);
	});
	it("ordnet Umlaut-Punkte der Zeile darunter zu, nicht der darüber", () => {
		// Zeile 1 bei y 40–70, Zeile 2 bei y 120–150, Punkte bei y 110 (über Zeile 2)
		const strokes = [...word(50, 40, 4), ...word(50, 120, 4), dot(60, 110), dot(66, 110)];
		expect(segmentLines(strokes).map(ids)).toEqual([[4], [6]]);
	});
	it("ignoriert versehentliche Tupfer weit unter der Zeile (würden die Zeile stauchen)", () => {
		// Zeile y 40–70 (Höhe 30); Tupfer 50 Einheiten darunter, i-Punkt knapp darüber bleibt
		const strokes = [...word(50, 40, 4), dot(60, 32), dot(200, 120)];
		const [line] = segmentLines(strokes);
		expect(ids(line)).toEqual([5]);
		expect(line[0].box.maxY).toBe(70);
	});
	it("trennt Antwortfelder bei großer horizontaler Lücke, Wortabstände bleiben im Segment", () => {
		const lines = segmentLines([...word(50, 40, 3), ...word(600, 42, 3)]);
		expect(lines.map(ids)).toEqual([[3, 3]]);
		// Wortabstand ≈ eine Zeilenhöhe (30) → gleiches Segment
		expect(segmentLines([...word(50, 40, 3), ...word(120, 41, 3)]).map(ids)).toEqual([[6]]);
	});
	it("teilt zu breite Segmente", () => {
		const lines = segmentLines(word(0, 40, 60), { maxAspect: 10 });
		expect(lines[0].length).toBeGreaterThan(1);
		for (const seg of lines[0]) expect((seg.box.maxX - seg.box.minX) / 30).toBeLessThanOrEqual(10.5);
	});
	it("ignoriert Textmarker; stabile Schlüssel unabhängig von der Reihenfolge", () => {
		const a = word(50, 40, 3);
		expect(segmentLines([...a, line(0, 50, 500, 50, "hl")]).map(ids)).toEqual([[3]]);
		expect(segmentLines(a)[0][0].key).toBe(segmentLines([...a].reverse())[0][0].key);
	});
	it("Referenzhöhe ignoriert Pünktchen", () => {
		expect(referenceHeight([...word(0, 0, 6), dot(1, 1), dot(5, 5)])).toBe(30);
	});
});

describe("rasterTransform", () => {
	it("skaliert auf Bildhöhe, rundet Breite auf Vielfaches von 4", () => {
		const t = rasterTransform({ minX: 100, minY: 50, maxX: 400, maxY: 90 }, 30, 64, 1024);
		expect(t.scale).toBeCloseTo(56 / 42);
		expect(t.width % 4).toBe(0);
		expect(t.width).toBeGreaterThanOrEqual(t.contentWidth);
		expect(100 * t.scale + t.offsetX).toBeCloseTo(4);
	});
	it("begrenzt die Breite", () => {
		const t = rasterTransform({ minX: 0, minY: 0, maxX: 5000, maxY: 30 }, 30, 64, 1024);
		expect(t.width).toBe(1024);
		expect(5000 * t.scale + t.offsetX).toBeLessThanOrEqual(1024);
	});
});

describe("toTensor", () => {
	const rgba = new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255]); // weiß, schwarz
	it("v2: Graustufen [0,1]", () => {
		const cfg = { input_channels: 1 } as HtrConfig;
		expect(Array.from(toTensor(rgba, 2, 1, cfg))).toEqual([1, 0]);
	});
	it("v1: CHW mit Normalisierung", () => {
		const cfg = { normalization: { mean: [0.5, 0.5, 0.5], std: [0.5, 0.5, 0.5] } } as HtrConfig;
		expect(Array.from(toTensor(rgba, 2, 1, cfg))).toEqual([1, -1, 1, -1, 1, -1]);
	});
});

describe("ctcGreedy", () => {
	const alphabet = "abc";
	// C = 4 (Blank + a,b,c); one-hot Logits je Zeitschritt
	const logits = (labels: number[]) => labels.flatMap((l) => [0, 1, 2, 3].map((c) => (c === l ? 10 : 0)));
	it("fasst Wiederholungen zusammen und entfernt Blanks", () => {
		const data = logits([1, 1, 0, 1, 2, 2, 0, 3]);
		expect(ctcGreedy(data, [1, 8, 4], alphabet).text).toBe("aabc");
		expect(ctcGreedy(data, [8, 1, 4], alphabet).text).toBe("aabc");
	});
	it("beachtet validSteps", () => {
		expect(ctcGreedy(logits([1, 2, 3]), [1, 3, 4], alphabet, { validSteps: 2 }).text).toBe("ab");
	});
	it("Konfidenz nahe 1 bei eindeutigen Logits", () => {
		expect(ctcGreedy(logits([1, 2]), [1, 2, 4], alphabet).confidence).toBeGreaterThan(0.99);
	});
	it("Leerzeichen normalisieren", () => {
		expect(ctcGreedy(logits([1, 0, 2]), [1, 3, 4], "a b").text).toBe("a");
	});
});

describe("boxOf", () => {
	it("über mehrere Striche", () => {
		expect(boxOf([line(1, 2, 3, 4), line(-1, 5, 0, 0)])).toEqual({ minX: -1, minY: 0, maxX: 3, maxY: 5 });
	});
});
