import { describe, expect, it } from "vitest";
import { recognizeShape, straightLine } from "./shapes";

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

// ---- Formerkennung ----

/** Freihand-Simulation: Punkte entlang der Ecken mit etwas Zittern. */
function hand(corners: [number, number][], closed: boolean, jitter = 2, step = 3): number[] {
	const pts = closed ? [...corners, corners[0]] : corners;
	const out: number[] = [];
	let k = 0;
	for (let i = 0; i < pts.length - 1; i++) {
		const [ax, ay] = pts[i];
		const [bx, by] = pts[i + 1];
		const n = Math.max(1, Math.round(Math.hypot(bx - ax, by - ay) / step));
		for (let j = 0; j < n; j++, k++) {
			const t = j / n;
			out.push(ax + (bx - ax) * t + jitter * Math.sin(k * 1.7), ay + (by - ay) * t + jitter * Math.cos(k * 2.3), 0.6);
		}
	}
	return out;
}

function handCircle(cx: number, cy: number, rx: number, ry: number, startDeg = 0, jitter = 2): number[] {
	const out: number[] = [];
	for (let i = 0; i <= 80; i++) {
		const t = ((startDeg + (i / 80) * 355) * Math.PI) / 180;
		out.push(cx + rx * Math.cos(t) + jitter * Math.sin(i * 1.3), cy + ry * Math.sin(t) + jitter * Math.cos(i * 1.9), 0.6);
	}
	return out;
}

const corners = (p: number[]) => {
	const xs = p.filter((_, i) => i % 3 === 0);
	const ys = p.filter((_, i) => i % 3 === 1);
	return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
};

describe("Formerkennung", () => {
	it("fast gerade Linie → Linie, waagerecht eingerastet", () => {
		const s = recognizeShape(hand([[100, 100], [300, 106]], false, 1.5));
		expect(s?.kind).toBe("line");
		expect(new Set(s?.points.filter((_, i) => i % 3 === 1))).toEqual(new Set([s?.points[1]]));
	});
	it("schräge Linie bleibt schräg", () => {
		const s = recognizeShape(hand([[100, 100], [250, 220]], false, 1.5));
		expect(s?.kind).toBe("line");
		const b = corners(s!.points);
		expect(b.maxY - b.minY).toBeGreaterThan(100);
	});
	it("Rechteck (Start mitten auf einer Kante) → achsparalleles Rechteck", () => {
		const s = recognizeShape(hand([[200, 100], [300, 100], [300, 180], [100, 180], [100, 100], [195, 100]], false));
		expect(s?.kind).toBe("rect");
		const b = corners(s!.points);
		expect(b.maxX - b.minX).toBeGreaterThan(195);
		expect(b.maxY - b.minY).toBeGreaterThan(75);
	});
	it("Dreieck", () => {
		expect(recognizeShape(hand([[100, 200], [200, 40], [300, 200]], true))?.kind).toBe("triangle");
	});
	it("Kreis und Ellipse", () => {
		const c = recognizeShape(handCircle(200, 200, 80, 78, 30));
		expect(c?.kind).toBe("ellipse");
		const bc = corners(c!.points);
		expect(Math.abs(bc.maxX - bc.minX - (bc.maxY - bc.minY))).toBeLessThan(2);
		const e = recognizeShape(handCircle(200, 200, 120, 50));
		expect(e?.kind).toBe("ellipse");
		const be = corners(e!.points);
		expect(be.maxX - be.minX).toBeGreaterThan(2 * (be.maxY - be.minY));
	});
	it("Handschrift und Kleines bleiben Freihand", () => {
		// „W“-artiger Zickzack, offen
		expect(recognizeShape(hand([[100, 100], [130, 160], [160, 110], [190, 160], [220, 100]], false))).toBeNull();
		// kleiner Kreis (Buchstabe o)
		expect(recognizeShape(handCircle(100, 100, 8, 8, 0, 0.5))).toBeNull();
		// Schleife/Spirale
		const spiral: number[] = [];
		for (let i = 0; i < 120; i++) {
			const t = i / 10;
			spiral.push(200 + t * 8 * Math.cos(t), 200 + t * 8 * Math.sin(t), 0.6);
		}
		expect(recognizeShape(spiral)).toBeNull();
	});
});
