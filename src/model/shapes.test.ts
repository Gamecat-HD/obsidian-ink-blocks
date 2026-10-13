import { describe, expect, it } from "vitest";
import { straightLine } from "./shapes";

const ys = (p: number[]) => p.filter((_, i) => i % 3 === 1);
const xs = (p: number[]) => p.filter((_, i) => i % 3 === 0);

describe("Gerade Textmarker-Linie", () => {
	it("leicht schräg → exakt waagerecht, dicht und mit konstantem Druck", () => {
		const p = straightLine(10, 100, 210, 110); // ~2,9°
		expect(new Set(ys(p))).toEqual(new Set([100]));
		expect(xs(p)[0]).toBe(10);
		expect(xs(p).at(-1)).toBe(210);
		expect(p.length / 3).toBeGreaterThan(40);
		expect(new Set(p.filter((_, i) => i % 3 === 2))).toEqual(new Set([0.5]));
	});
	it("auch von rechts nach links", () => {
		expect(new Set(ys(straightLine(300, 50, 100, 60)))).toEqual(new Set([50]));
	});
	it("deutlich schräg bleibt schräg", () => {
		const p = straightLine(0, 0, 100, 50);
		expect(ys(p).at(-1)).toBe(50);
		expect(xs(p).at(-1)).toBe(100);
	});
	it("ohne Bewegung: Start = Ende", () => {
		expect(straightLine(5, 5, 5, 5).length).toBe(6);
	});
});
