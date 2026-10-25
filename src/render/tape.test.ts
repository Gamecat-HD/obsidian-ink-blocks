import { describe, expect, it } from "vitest";
import { tapeHit, tapeOutline, tapeSvg } from "./tape";

describe("Abdeckband", () => {
	const band = [0, 0, 0.5, 100, 0, 0.5];

	it("Umriss: Rechteck mit Zacken an beiden Enden", () => {
		const poly = tapeOutline(band, 20);
		const xs = poly.map((p) => p[0]);
		const ys = poly.map((p) => p[1]);
		expect(Math.min(...ys)).toBeCloseTo(-10);
		expect(Math.max(...ys)).toBeCloseTo(10);
		expect(Math.max(...xs)).toBeCloseTo(102.4); // Zacken ragen 0,12 × Breite heraus
		expect(Math.min(...xs)).toBeCloseTo(-2.4);
		expect(poly.length).toBe(2 + 8 + 1 + 7); // Ecken oben, Zacken b (bis Ecke unten), Ecke a unten, Zacken a
	});

	it("getippt → kurzes Stück; zu wenige Punkte → nichts", () => {
		const poly = tapeOutline([5, 5, 0.5], 20);
		expect(Math.max(...poly.map((p) => p[0]))).toBeGreaterThan(14);
		expect(tapeOutline([], 20)).toEqual([]);
		expect(tapeSvg([], 20)).toBe("");
		expect(tapeSvg(band, 20)).toMatch(/^M.*Z$/);
	});

	it("Treffer auf dem Band", () => {
		expect(tapeHit(band, 20, 50, 9)).toBe(true);
		expect(tapeHit(band, 20, 50, 11)).toBe(false);
		expect(tapeHit(band, 20, 120, 0)).toBe(false);
	});
});
