// Mikro-Benchmark (Node, ohne DOM) für die Kosten pro Stiftbewegung und pro Neumalen eines Bereichs.
// Vergleicht den bisherigen Weg (ganzer Umriss → SVG-String; Filter über alle Striche) mit dem neuen
// (Umriss → Pfadbefehle + geänderter Bereich; räumlicher Index). Aufruf: npm run bench:ink
// Canvas-Kosten (Path2D, Füllen, Rastern) misst scripts/e2e/bench/perf-ink.mjs in einer echten Obsidian-Instanz.
import type { Stroke } from "../../src/model/ink-format";
import { strokeBounds } from "../../src/model/ops";
import { StrokeIndex } from "../../src/render/strokeIndex";
import { outlineChange, outlineSvg, outlineToPath, strokeOutline, type PathSink } from "../../src/render/strokes";

function rng(seed: number) {
	return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

function hand(n: number, x0 = 60, y0 = 120): number[] {
	const p: number[] = [];
	for (let i = 0; i < n; i++) {
		const t = i / 6;
		p.push(x0 + ((i * 0.85) % 860) + 6 * Math.cos(t), y0 + 9 * Math.sin(t) + Math.floor((i * 0.85) / 860) * 40, 0.3 + 0.5 * Math.abs(Math.sin(t / 3)));
	}
	return p;
}

/** Zählt nur Befehle – steht für Path2D-Aufrufe. */
const sink: PathSink & { n: number } = {
	n: 0,
	moveTo() {
		this.n++;
	},
	quadraticCurveTo() {
		this.n++;
	},
	closePath() {
		this.n++;
	},
};

const style = { tool: "pen" as const, size: 3 };

/** Kosten pro Bewegung (µs) bei Strichlänge ≈ n, gemittelt über die letzten 50 Bewegungen. */
function liveCost(n: number) {
	const pts = hand(n);
	const reps = 20;
	let oldT = 0;
	let newT = 0;
	let area = 0;
	let full = 0;
	for (let r = 0; r < reps; r++) {
		let prev = strokeOutline(pts.slice(0, (n - 51) * 3), style, false);
		for (let k = n - 50; k <= n; k++) {
			const p = pts.slice(0, k * 3);
			let t0 = performance.now();
			outlineSvg(p, style, false);
			oldT += performance.now() - t0;
			t0 = performance.now();
			const o = strokeOutline(p, style, false);
			outlineToPath(o, sink);
			const ch = outlineChange(prev, o);
			newT += performance.now() - t0;
			prev = o;
			if (r === 0 && ch && ch !== "same") {
				const b = strokeBounds({ id: "", tool: "pen", color: 0, size: 3, points: p });
				area += ((ch.maxX - ch.minX) * (ch.maxY - ch.minY)) / ((b.maxX - b.minX) * (b.maxY - b.minY));
				full++;
			}
		}
	}
	const per = reps * 51;
	return { oldUs: +((oldT / per) * 1000).toFixed(1), newUs: +((newT / per) * 1000).toFixed(1), dirtyAreaShare: +(area / full).toFixed(4) };
}

function strokes(count: number, height: number): Stroke[] {
	const r = rng(7);
	const out: Stroke[] = [];
	for (let i = 0; i < count; i++) {
		const n = 30 + Math.floor(r() * 40);
		out.push({ id: `s${i}`, tool: "pen", color: 0, size: 3, points: hand(n, 20 + r() * 900, 30 + r() * (height - 60)).map((v, j) => (j % 3 === 0 ? v * 0.1 + 20 + r() : v)) });
	}
	return out;
}

/** Strich-Auswahl für einen kleinen Bereich (Live-Ende, Strich-Ende) und eine ganze Kachel. */
function selectCost(count: number) {
	const list = strokes(count, 1400);
	list.forEach(strokeBounds);
	const index = new StrokeIndex();
	index.sync(list);
	const filter = (top: number, bottom: number, left: number, right: number) =>
		list.filter((s) => {
			const b = strokeBounds(s);
			if (b.maxY < top || b.minY > bottom) return false;
			return b.maxX >= left && b.minX <= right;
		});
	const regions: [number, number, number, number][] = [];
	const r = rng(3);
	for (let i = 0; i < 200; i++) {
		const x = r() * 900;
		const y = r() * 1300;
		regions.push([y, y + 30, x, x + 40]);
	}
	const time = (fn: () => void, reps: number) => {
		const t0 = performance.now();
		for (let i = 0; i < reps; i++) fn();
		return ((performance.now() - t0) / reps) * 1000;
	};
	const small = (q: typeof filter) => () => regions.forEach((g) => q(...g));
	return {
		smallRegion_filterUs: +(time(small(filter), 20) / regions.length).toFixed(2),
		smallRegion_indexUs: +(time(small((a, b, c, d) => index.query(a, b, c, d)), 20) / regions.length).toFixed(2),
		syncUnchangedUs: +time(() => index.sync(list), 200).toFixed(2),
		rebuildUs: +time(() => new StrokeIndex().sync(list), 20).toFixed(1),
	};
}

for (const n of [200, 1000]) console.log(`Live-Strich ${n} Punkte, pro Bewegung:`, liveCost(n));
for (const c of [500, 5000]) console.log(`${c} Striche, Auswahl je Bereich:`, selectCost(c));
