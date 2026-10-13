import { describe, expect, it } from "vitest";
import { createNotebook, decodeInk, decodePoints, encodeInk, encodePoints, InkFormatError, type InkData } from "./ink-format";

function sample(): InkData {
	const doc = createNotebook("a1b2");
	doc.h = 700;
	doc.strokes.push(
		{ id: "s1", tool: "pen", color: 0, size: 3, points: [10.04, 20.51, 0.5, 12.333, 21.987, 0.73, 15, 25, 1] },
		{ id: "s2", tool: "hl", color: 2, size: 12, points: [100, 100, 0.2], simulated: true },
		{ id: "s3", tool: "pen", color: 1, size: 3, points: [0, 0, 0.5, 50, 0, 0.5], simulated: true, shape: true },
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
		]);
		expect(back.strokes.map((s) => s.simulated)).toEqual([undefined, true, true]);
		expect(back.strokes.map((s) => s.shape)).toEqual([undefined, undefined, true]);
	});
	it("schreibt einen Strich pro Zeile", () => {
		const lines = encodeInk(sample()).trimEnd().split("\n");
		expect(lines).toHaveLength(5);
		expect(lines[1]).toMatch(/^\{"id":"s1"/);
	});
	it("leeres Dokument ist gültiges JSON", () => {
		const text = encodeInk(createNotebook("x"));
		expect(JSON.parse(text).strokes).toEqual([]);
		expect(decodeInk(text).strokes).toEqual([]);
	});
	it("lehnt kaputte Daten ab", () => {
		expect(() => decodeInk("{")).toThrow(InkFormatError);
		expect(() => decodeInk('{"v":2}')).toThrow(/Version/);
		const bad = JSON.parse(encodeInk(sample()));
		bad.strokes[0].p.push(1);
		expect(() => decodeInk(JSON.stringify(bad))).toThrow(/Punkte/);
	});
});
