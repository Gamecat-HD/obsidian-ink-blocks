import { describe, expect, it } from "vitest";
import { outlineChange, outlineToPath, strokeOutline, type PathSink } from "./strokes";
import { svgPathFromOutline } from "./svgPath";

type Seg = [number, number, number, number, number, number]; // Start, Kontrollpunkt, Ende

/** Zeichnet die Pfadbefehle als Kurvenstücke auf. */
function record(outline: number[][]): { segs: Seg[]; closed: boolean } {
	const segs: Seg[] = [];
	let x = 0;
	let y = 0;
	let closed = false;
	const sink: PathSink = {
		moveTo(nx, ny) {
			x = nx;
			y = ny;
		},
		quadraticCurveTo(cx, cy, nx, ny) {
			segs.push([x, y, cx, cy, nx, ny]);
			x = nx;
			y = ny;
		},
		closePath() {
			closed = true;
		},
	};
	outlineToPath(outline, sink);
	return { segs, closed };
}

/** Handschrift-ähnlicher Strich (Schleifen), Punkte wie aus der PointerPipeline. */
function hand(n: number, seed = 0): number[] {
	const p: number[] = [];
	for (let i = 0; i < n; i++) {
		const t = i / 6 + seed;
		p.push(60 + i * 0.85 + 6 * Math.cos(t), 120 + 9 * Math.sin(t), 0.3 + 0.5 * Math.abs(Math.sin(t / 3)));
	}
	return p;
}

const pen = { tool: "pen" as const, size: 3 };

describe("outlineToPath", () => {
	it("entspricht svgPathFromOutline (M, Q, T-Kette, Z) bis auf die Rundung", () => {
		const outline = strokeOutline(hand(120), pen, true);
		const { segs, closed } = record(outline);
		expect(closed).toBe(true);
		// Endpunkte aus dem SVG-String: M x,y Q cx,cy ex,ey T e2 e3 …
		const nums = svgPathFromOutline(outline).match(/-?\d+(\.\d+)?/g)!.map(Number);
		const ends: [number, number][] = [[nums[4], nums[5]]];
		for (let i = 6; i + 1 < nums.length; i += 2) ends.push([nums[i], nums[i + 1]]);
		expect(segs.length).toBe(ends.length);
		segs.forEach((s, i) => {
			expect(Math.abs(s[4] - ends[i][0])).toBeLessThanOrEqual(0.0051);
			expect(Math.abs(s[5] - ends[i][1])).toBeLessThanOrEqual(0.0051);
			// Kontrollpunkt = Umrisspunkt (exakte T-Spiegelung)
			expect(s[2]).toBe(outline[i + 1][0]);
			expect(s[3]).toBe(outline[i + 1][1]);
		});
	});

	it("leerer Pfad bei weniger als 4 Umrisspunkten (wie der SVG-String)", () => {
		expect(record([[0, 0], [1, 1], [2, 2]]).segs).toEqual([]);
		expect(svgPathFromOutline([[0, 0], [1, 1], [2, 2]])).toBe("");
	});
});

describe("outlineChange", () => {
	const inside = (b: { minX: number; minY: number; maxX: number; maxY: number }, x: number, y: number) =>
		x >= b.minX - 1e-9 && x <= b.maxX + 1e-9 && y >= b.minY - 1e-9 && y <= b.maxY + 1e-9;

	for (const [label, style] of [
		["Stift mit Druck", pen],
		["Maus (simulierter Druck)", { ...pen, simulated: true }],
		["Textmarker", { tool: "hl" as const, size: 12 }],
	] as const) {
		it(`deckt beim wachsenden Strich jedes geänderte Kurvenstück ab (${label})`, () => {
			const pts = hand(400, 1);
			let prev = strokeOutline(pts.slice(0, 3), style, false);
			let small = 0;
			let steps = 0;
			for (let n = 2; n <= 400; n++) {
				const next = strokeOutline(pts.slice(0, n * 3), style, false);
				const region = outlineChange(prev, next);
				const a = record(prev).segs;
				const b = record(next).segs;
				if (region === "same") {
					expect(a).toEqual(b);
				} else if (region !== null) {
					const key = (s: Seg) => s.join(",");
					const inB = new Set(b.map(key));
					const inA = new Set(a.map(key));
					// Jedes Stück, das es nur in einem der beiden Umrisse gibt, liegt (samt Kontrollpunkt) im Bereich.
					for (const s of [...a.filter((s) => !inB.has(key(s))), ...b.filter((s) => !inA.has(key(s)))]) {
						for (let k = 0; k < 6; k += 2) expect(inside(region, s[k], s[k + 1])).toBe(true);
					}
					steps++;
					const all = { w: Math.max(...next.map((p) => p[0])) - Math.min(...next.map((p) => p[0])) };
					if (region.maxX - region.minX < all.w * 0.25) small++;
				}
				prev = next;
			}
			// Der Nutzen: bei langen Strichen ist der Bereich fast immer klein.
			expect(steps).toBeGreaterThan(300);
			expect(small / steps).toBeGreaterThan(0.8);
		});
	}

	it("null, wenn sich der Anfang ändert (z. B. Form erkannt)", () => {
		const a = strokeOutline(hand(50), pen, false);
		const b = strokeOutline(hand(50, 2), pen, false);
		expect(outlineChange(a, b)).toBeNull();
		expect(outlineChange(a, a.map((p) => [...p]))).toBe("same");
	});
});
