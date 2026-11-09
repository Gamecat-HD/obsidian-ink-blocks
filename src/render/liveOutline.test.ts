import { getStroke } from "perfect-freehand";
import { describe, expect, it } from "vitest";
import { LiveOutline } from "./liveOutline";
import { strokeOptions } from "./strokes";

function rng(seed: number) {
	return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

const triples = (p: number[]) => {
	const out: number[][] = [];
	for (let i = 0; i < p.length; i += 3) out.push([p[i], p[i + 1], p[i + 2]]);
	return out;
};

type Gen = (i: number, r: () => number) => [number, number, number];

const paths: Record<string, Gen> = {
	// Schreibschrift-Schleifen mit wechselndem Druck
	hand: (i) => [60 + i * 0.85 + 6 * Math.cos(i / 6), 120 + 9 * Math.sin(i / 6), 0.3 + 0.5 * Math.abs(Math.sin(i / 18))],
	// Zickzack mit Spitzen (scharfe Ecken, Eckkappen)
	zigzag: (i) => [100 + (i % 20 < 10 ? i % 10 : 10 - (i % 10)) * 4, 100 + i * 0.7, 0.6],
	// Zittern auf der Stelle, doppelte Punkte, Sprünge
	jitter: (i, r) => {
		const base = Math.floor(i / 7) * 2;
		return r() < 0.15 ? [200 + base, 200, 0.5] : [200 + base + r() * 0.4, 200 + r() * 0.4, r()];
	},
	// langsamer Start (viele winzige Schritte), dann schnell
	slowStart: (i) => (i < 40 ? [300 + i * 0.05, 300 + i * 0.02, 0.2] : [300 + (i - 38) * 3, 300 + Math.sin(i) * 5, 0.8]),
	// zufällige Bewegung mit Druck 0 und 1
	random: (i, r) => [400 + Math.sin(i / 3) * 30 + r() * 4, 400 + Math.cos(i / 5) * 30 + r() * 4, r() < 0.1 ? 0 : r() < 0.1 ? 1 : r()],
};

const styles = {
	pen: { tool: "pen" as const, size: 3 },
	penThick: { tool: "pen" as const, size: 9 },
	mouse: { tool: "pen" as const, size: 3, simulated: true },
	hl: { tool: "hl" as const, size: 14 },
	shape: { tool: "pen" as const, size: 3, shape: true },
};

describe("LiveOutline", () => {
	for (const [pname, gen] of Object.entries(paths)) {
		for (const [sname, style] of Object.entries(styles)) {
			it(`gleich getStroke(last: false) nach jedem Punkt – ${pname}, ${sname}`, () => {
				const r = rng(pname.length * 31 + sname.length);
				const opts = strokeOptions(style, false);
				const live = new LiveOutline();
				const pts: number[] = []; // wächst an Ort und Stelle wie in der PointerPipeline
				for (let i = 0; i < 260; i++) {
					pts.push(...gen(i, r));
					const got = live.update(pts, opts);
					const want = getStroke(triples(pts), opts);
					if (got.length !== want.length || got.some((p, k) => p[0] !== want[k][0] || p[1] !== want[k][1])) {
						expect({ n: i + 1, got }).toEqual({ n: i + 1, got: want });
					}
				}
				// wirklich inkrementell: der größte Teil des Umrisses steht fest
				if (pname !== "jitter") expect((live as unknown as { oc: number }).oc).toBeGreaterThan(150);
			});
		}
	}

	it("neues Array (Form erkannt) oder andere Optionen: neu anfangen", () => {
		const live = new LiveOutline();
		const opts = strokeOptions(styles.pen, false);
		const pts: number[] = [];
		for (let i = 0; i < 100; i++) pts.push(...paths.hand(i, Math.random));
		live.update(pts, opts);
		const shape = [10, 10, 0.5, 200, 10, 0.5, 200, 200, 0.5, 10, 200, 0.5, 10, 10, 0.5];
		const sOpts = strokeOptions(styles.shape, false);
		expect(live.update(shape, sOpts)).toEqual(getStroke(triples(shape), sOpts));
		// dasselbe Array, an Ort und Stelle verändert (nicht nur angehängt)
		pts[30] += 5;
		expect(live.update(pts, opts)).toEqual(getStroke(triples(pts), opts));
		pts.length = 150; // gekürzt
		expect(live.update(pts, opts)).toEqual(getStroke(triples(pts), opts));
	});

	it("wenige Punkte und abgeschlossene Striche gehen direkt an getStroke", () => {
		const live = new LiveOutline();
		const opts = strokeOptions(styles.pen, false);
		for (const p of [[], [5, 5, 0.5], [5, 5, 0.5, 9, 9, 0.5]]) expect(live.update(p, opts)).toEqual(getStroke(triples(p), opts));
		const done = strokeOptions(styles.pen, true);
		const pts = [1, 1, 0.5, 5, 7, 0.5, 9, 3, 0.6, 15, 4, 0.7];
		expect(live.update(pts, done)).toEqual(getStroke(triples(pts), done));
	});
});
