import { describe, expect, it } from "vitest";
import { createNotebook, decodeInk, decodePoints, encodeInk, encodePoints, InkFormatError, type InkData } from "./ink-format";

function sample(): InkData {
	const doc = createNotebook("a1b2");
	doc.h = 700;
	doc.strokes.push(
		{ id: "s1", tool: "pen", color: 0, size: 3, points: [10.04, 20.51, 0.5, 12.333, 21.987, 0.73, 15, 25, 1] },
		{ id: "s2", tool: "hl", color: 2, size: 12, points: [100, 100, 0.2], simulated: true },
		{ id: "s3", tool: "pen", color: 1, size: 3, points: [0, 0, 0.5, 50, 0, 0.5], simulated: true, shape: true },
		{ id: "s4", tool: "tape", color: 6, size: 26, points: [0, 40, 0.5, 300, 40, 0.5] },
		{ id: "s5", tool: "pen", color: "#7048e8", size: 3, points: [1, 1, 0.5] },
	);
	doc.ocr = { engine: "htr-v2@abcd", lines: { deadbeef: "Hallo" }, written: "1234abcd" };
	return doc;
}

describe("Punkte-Codec", () => {
	it("Round-Trip mit Quantisierungsfehler ≤ 0,05 und Druckfehler ≤ 1/510", () => {
		const pts = [0.01, 999.99, 0, 333.333, 0.049, 0.5, 333.36, 0.06, 1];
		const back = decodePoints(encodePoints(pts));
		for (let i = 0; i < pts.length; i += 3) {
			expect(Math.abs(back[i] - pts[i])).toBeLessThanOrEqual(0.05);
			expect(Math.abs(back[i + 1] - pts[i + 1])).toBeLessThanOrEqual(0.05);
			expect(Math.abs(back[i + 2] - pts[i + 2])).toBeLessThanOrEqual(1 / 510 + 1e-9);
		}
	});
	it("ist delta-codiert (kleine Zahlen bei benachbarten Punkten)", () => {
		expect(encodePoints([100, 100, 0.5, 100.5, 100.2, 0.5])).toEqual([1000, 1000, 128, 5, 2, 0]);
	});
	it("klemmt Druck auf [0, 1]", () => {
		expect(decodePoints(encodePoints([0, 0, 3, 0, 0, -1]))).toEqual([0, 0, 1, 0, 0, 0]);
	});
});

describe("encodeInk/decodeInk", () => {
	it("Round-Trip erhält Struktur", () => {
		const doc = sample();
		const back = decodeInk(encodeInk(doc));
		expect(back).toMatchObject({ v: 1, id: "a1b2", space: "nb", w: 1000, h: 700, ocr: doc.ocr });
		expect(back.strokes.map((s) => [s.id, s.tool, s.color, s.size, s.points.length])).toEqual([
			["s1", "pen", 0, 3, 9],
			["s2", "hl", 2, 12, 3],
			["s3", "pen", 1, 3, 6],
			["s4", "tape", 6, 26, 6],
			["s5", "pen", "#7048e8", 3, 3],
		]);
		expect(back.strokes.map((s) => s.simulated)).toEqual([undefined, true, true, undefined, undefined]);
		expect(back.strokes.map((s) => s.shape)).toEqual([undefined, undefined, true, undefined, undefined]);
	});
	it("schreibt einen Strich pro Zeile", () => {
		const lines = encodeInk(sample()).trimEnd().split("\n");
		expect(lines).toHaveLength(7);
		expect(lines[1]).toMatch(/^\{"id":"s1"/);
	});
	it("leeres Dokument ist gültiges JSON", () => {
		const text = encodeInk(createNotebook("x"));
		expect(JSON.parse(text).strokes).toEqual([]);
		expect(decodeInk(text).strokes).toEqual([]);
	});
	it("eigene Farben nur als #rrggbb", () => {
		const bad = '{"v":1,"id":"x","space":"nb","w":1000,"h":400,"strokes":[{"id":"a","t":"pen","c":"red","s":2,"p":[0,0,0]}]}';
		expect(() => decodeInk(bad)).toThrow(/Strich 0/);
	});
	it("lehnt kaputte Daten ab", () => {
		expect(() => decodeInk("{")).toThrow(InkFormatError);
		expect(() => decodeInk('{"v":2}')).toThrow(/Version/);
		const bad = JSON.parse(encodeInk(sample()));
		bad.strokes[0].p.push(1);
		expect(() => decodeInk(JSON.stringify(bad))).toThrow(/Punkte/);
	});
});

describe("encodeInk – Zeilen-Cache", () => {
	it("gleiches Ergebnis beim wiederholten Kodieren und für inhaltsgleiche neue Objekte", () => {
		const doc = sample();
		const first = encodeInk(doc);
		expect(encodeInk(doc)).toBe(first);
		const copy: InkData = { ...doc, strokes: doc.strokes.map((s) => ({ ...s, points: s.points.slice() })) };
		expect(encodeInk(copy)).toBe(first);
		// hinzugefügter Strich erscheint, entfernter verschwindet
		const more: InkData = { ...doc, strokes: [...doc.strokes, { id: "neu", tool: "pen", color: 1, size: 2, points: [1, 2, 0.5] }] };
		expect(decodeInk(encodeInk(more)).strokes.map((s) => s.id)).toEqual([...doc.strokes.map((s) => s.id), "neu"]);
		expect(decodeInk(encodeInk({ ...doc, strokes: doc.strokes.slice(1) })).strokes).toHaveLength(doc.strokes.length - 1);
	});
});
