import { describe, expect, it } from "vitest";
import type { Stroke } from "../model/ink-format";
import { strokeBounds } from "../model/ops";
import { strokeDiff, StrokeIndex } from "./strokeIndex";

function rng(seed: number) {
	return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

function randomStrokes(n: number, seed = 1): Stroke[] {
	const r = rng(seed);
	const out: Stroke[] = [];
	for (let i = 0; i < n; i++) {
		const x = r() * 1000;
		const y = r() * 3000 - 50;
		// ein paar sehr hohe Striche (über viele Bänder) und solche oberhalb von 0
		const tall = r() < 0.03 ? 2000 * r() : 40 * r();
		const pts: number[] = [];
		const m = 2 + Math.floor(r() * 20);
		for (let k = 0; k < m; k++) pts.push(x + r() * 60, y + (tall * k) / m, r());
		out.push({ id: `s${i}`, tool: r() < 0.2 ? "hl" : "pen", color: 0, size: 1 + r() * 8, points: pts });
	}
	// ein riesiger Strich (breiter als MAX_BANDS Bänder)
	out.push({ id: "huge", tool: "pen", color: 0, size: 3, points: [10, -100, 0.5, 20, 40000, 0.5] });
	return out;
}

const brute = (list: Stroke[], top: number, bottom: number, left = -Infinity, right = Infinity) =>
	list.filter((s) => {
		const b = strokeBounds(s);
		if (b.maxY < top || b.minY > bottom) return false;
		return b.maxX >= left && b.minX <= right;
	});

describe("StrokeIndex", () => {
	it("liefert dieselben Striche in derselben Reihenfolge wie der Filter über alle", () => {
		const list = randomStrokes(2000);
		const index = new StrokeIndex();
		index.sync(list);
		const r = rng(9);
		for (let q = 0; q < 300; q++) {
			const top = r() * 3200 - 100;
			const bottom = top + r() * (q % 10 === 0 ? 2000 : 80);
			const withX = q % 2 === 0;
			const left = withX ? r() * 1000 : -Infinity;
			const right = withX ? left + r() * 200 : Infinity;
			expect(index.query(top, bottom, left, right)).toEqual(brute(list, top, bottom, left, right));
		}
	});

	it("erkennt Änderungen an der Strichliste per Identität", () => {
		const list = randomStrokes(50, 3);
		const index = new StrokeIndex();
		expect(index.sync(list)).toBe(true);
		expect(index.sync(list)).toBe(false);
		expect(index.sync(list.slice())).toBe(false); // gleiche Objekte, neues Array
		// gleiche Länge, ein Strich ersetzt (präzises Radieren mit einem Reststück)
		const replaced = list.slice();
		replaced[10] = { ...list[10], id: "neu", points: [500, 2500, 0.5] };
		expect(index.sync(replaced)).toBe(true);
		expect(index.query(2490, 2510, 490, 510).map((s) => s.id)).toContain("neu");
		expect(index.query(-1e9, 1e9).map((s) => s.id)).not.toContain(list[10].id);
		// Reihenfolge geändert
		const swapped = replaced.slice();
		[swapped[0], swapped[1]] = [swapped[1], swapped[0]];
		expect(index.sync(swapped)).toBe(true);
		expect(index.query(-1e9, 1e9)).toEqual(swapped);
	});

	it("leeres Dokument und viele Abfragen (Generationszähler)", () => {
		const index = new StrokeIndex();
		index.sync([]);
		expect(index.query(0, 1000)).toEqual([]);
		const list = randomStrokes(10, 5);
		index.sync(list);
		for (let i = 0; i < 1000; i++) index.query(0, 100);
		expect(index.query(-1e9, 1e9)).toEqual(list);
	});
});

describe("strokeDiff", () => {
	const list = randomStrokes(30, 11);

	it("gleiche Liste: nichts zu tun", () => {
		expect(strokeDiff(list, list)).toEqual([]);
		expect(strokeDiff(list, list.slice())).toEqual([]);
	});

	it("hinzugefügt, entfernt, ersetzt: Bounds genau dieser Striche", () => {
		const added = { ...list[0], id: "neu", points: [1, 2, 0.5] };
		expect(strokeDiff(list, [...list, added])).toEqual([strokeBounds(added)]);
		expect(strokeDiff(list, list.filter((_, i) => i !== 7))).toEqual([strokeBounds(list[7])]);
		const replaced = list.slice();
		replaced.splice(4, 1, added);
		expect(strokeDiff(list, replaced)).toEqual([strokeBounds(list[4]), strokeBounds(added)]);
		// Merge-Fall: fremde Striche vorne eingefügt, eigene bleiben in gleicher Reihenfolge
		expect(strokeDiff(list, [added, ...list])).toEqual([strokeBounds(added)]);
	});

	it("geänderte Reihenfolge gemeinsamer Striche: alles neu (null)", () => {
		const swapped = list.slice();
		[swapped[3], swapped[20]] = [swapped[20], swapped[3]];
		expect(strokeDiff(list, swapped)).toBeNull();
	});

	it("von/zu leer", () => {
		expect(strokeDiff([], list)).toHaveLength(list.length);
		expect(strokeDiff(list, [])).toHaveLength(list.length);
	});
});
