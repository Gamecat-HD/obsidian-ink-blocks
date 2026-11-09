import { getStroke, type StrokeOptions } from "perfect-freehand";

/**
 * Inkrementeller Umriss für den Live-Strich: liefert bei jedem Aufruf **exakt** dasselbe wie
 * `getStroke(punkte, { …, last: false })` von perfect-freehand 1.2 (siehe liveOutline.test.ts, Vergleich
 * Zahl für Zahl), rechnet aber nur die neuen Punkte und das Ende neu statt den ganzen Strich.
 *
 * Nachbau von getStrokePoints + getStrokeOutlinePoints (perfect-freehand, MIT, © Steve Ruiz) für den Fall
 * ohne Verjüngung (taper) mit runden Enden – so wie strokeOptions() sie setzt. Dieselben Rechenschritte in
 * derselben Reihenfolge, damit die Gleitkommaergebnisse bitgleich sind:
 *  - Strichpunkte (geglättet, streamline) hängen nur von den vorherigen ab → alle außer dem letzten stehen fest.
 *  - Umrisspunkt i hängt von Punkt i+1 (Richtung), vom Anfangsdruck (erste 10 Punkte) und davon ab, ob er
 *    näher als 3 Einheiten am Strichende liegt (dann ausgelassen). Steht das fest, wird er übernommen;
 *    der Rest (das Ende) wird jedes Mal neu gerechnet, ebenso die Kappen.
 * Für fertige Striche bleibt es bei getStroke (strokes.ts).
 */

type Vec2 = [number, number];

interface StrokePoint {
	point: Vec2;
	pressure: number;
	vector: Vec2;
	distance: number;
	runningLength: number;
}

/** Zustand der Umrissberechnung nach einem Punkt (die Variablen der Schleife in getStrokeOutlinePoints). */
interface OutlineState {
	prevPressure: number;
	radius: number;
	firstRadius: number | undefined;
	prevVector: Vec2;
	prevLeftPoint: Vec2;
	prevRightPoint: Vec2;
	isPrevPointSharpCorner: boolean;
}

// Konstanten aus perfect-freehand/src/constants.ts
const RATE_OF_PRESSURE_CHANGE = 0.275;
const FIXED_PI = Math.PI + 0.0001;
const START_CAP_SEGMENTS = 13;
const END_CAP_SEGMENTS = 29;
const CORNER_CAP_SEGMENTS = 13;
const END_NOISE_THRESHOLD = 3;
const MIN_STREAMLINE_T = 0.15;
const STREAMLINE_T_RANGE = 0.85;
const MIN_RADIUS = 0.01;
const DEFAULT_FIRST_PRESSURE = 0.25;
const DEFAULT_PRESSURE = 0.5;
/** Anfangsdruck = Mittel über so viele Punkte (computeInitialPressure). */
const INITIAL_PRESSURE_POINTS = 10;

const isValidPressure = (p: number | undefined): p is number => p != null && p >= 0;

function rotAround(A: Vec2, C: Vec2, r: number): Vec2 {
	const s = Math.sin(r);
	const c = Math.cos(r);
	const px = A[0] - C[0];
	const py = A[1] - C[1];
	const nx = px * c - py * s;
	const ny = px * s + py * c;
	return [nx + C[0], ny + C[1]];
}

function simulatePressure(prevPressure: number, distance: number, size: number): number {
	const sp = Math.min(1, distance / size);
	const rp = Math.min(1, 1 - sp);
	return Math.min(1, prevPressure + (rp - prevPressure) * (sp * RATE_OF_PRESSURE_CHANGE));
}

export class LiveOutline {
	private opts: Required<Pick<StrokeOptions, "size" | "thinning" | "smoothing" | "streamline" | "simulatePressure">> | null = null;
	private optsKey = "";
	/** Eingabe-Array (Identität) und wie viele seiner Punkte schon fest verarbeitet sind. */
	private src: number[] | null = null;
	private consumed = 0;
	/** Letzter fest verarbeiteter Eingabepunkt – Schutz gegen nachträglich geänderte Punkte. */
	private guard: number[] = [];
	// getStrokePoints
	private t = 0;
	private sp: StrokePoint[] = [];
	private prev: StrokePoint | null = null;
	private runningLength = 0;
	private reached = false;
	// getStrokeOutlinePoints: Punkte [0, oc) stehen fest
	private oc = 0;
	private left: Vec2[] = [];
	private right: Vec2[] = [];
	private state: OutlineState | null = null;
	private initialPressure = 0;

	/** Umriss der Punkte `[x, y, p, …]` – wie getStroke mit `last: false`. */
	update(points: number[], options: StrokeOptions): number[][] {
		const n = points.length / 3;
		const key = `${options.size}|${options.thinning}|${options.smoothing}|${options.streamline}|${options.simulatePressure}|${options.last}`;
		if (options.last || n < 3 || options.start?.taper || options.end?.taper || options.easing || options.start || options.end) {
			this.src = null;
			return getStroke(triples(points), options);
		}
		if (key !== this.optsKey || points !== this.src || n - 1 < this.consumed || !this.guardOk(points)) this.reset(points, options, key);
		this.advance(points, n);
		// Der letzte Punkt kommt nur vorübergehend dazu (beim nächsten Aufruf wird er fest oder ersetzt).
		const committed = this.sp.length;
		const tentative = this.tentative(points, n);
		if (tentative) this.sp.push(tentative);
		const sp0 = this.sp[0];
		// strokePoints[0].vector = strokePoints[1]?.vector || [0, 0]
		sp0.vector = this.sp[1]?.vector || [0, 0];
		try {
			if (this.sp.length < 2) {
				// Nur ein Punkt (alles deckungsgleich): perfect-freehand zeichnet einen Punkt – selten, nicht inkrementell.
				this.src = null;
				return getStroke(triples(points), options);
			}
			return this.outline(this.sp, committed);
		} finally {
			if (tentative) this.sp.pop();
		}
	}

	private reset(points: number[], o: StrokeOptions, key: string) {
		this.optsKey = key;
		this.opts = {
			size: o.size ?? 16,
			thinning: o.thinning ?? 0.5,
			smoothing: o.smoothing ?? 0.5,
			streamline: o.streamline ?? 0.5,
			simulatePressure: o.simulatePressure ?? true,
		};
		this.src = points;
		this.t = MIN_STREAMLINE_T + (1 - this.opts.streamline) * STREAMLINE_T_RANGE;
		const first: StrokePoint = {
			point: [points[0], points[1]],
			pressure: isValidPressure(points[2]) ? points[2] : DEFAULT_FIRST_PRESSURE,
			vector: [1, 1],
			distance: 0,
			runningLength: 0,
		};
		this.sp = [first];
		this.prev = first;
		this.runningLength = 0;
		this.reached = false;
		this.consumed = 1;
		this.guard = [];
		this.oc = 0;
		this.left = [];
		this.right = [];
		this.state = null;
	}

	private guardOk(points: number[]): boolean {
		const g = this.guard;
		if (!g.length) return true;
		const i = (this.consumed - 1) * 3;
		return points[i] === g[0] && points[i + 1] === g[1] && points[i + 2] === g[2];
	}

	/** Strichpunkte: alle Eingabepunkte außer dem letzten fest verarbeiten (getStrokePoints, `i < max`). */
	private advance(points: number[], n: number) {
		const { size } = this.opts!;
		const t = this.t;
		let prev = this.prev!;
		for (let i = this.consumed; i < n - 1; i++) {
			const x = points[i * 3];
			const y = points[i * 3 + 1];
			const point: Vec2 = [prev.point[0] + (x - prev.point[0]) * t, prev.point[1] + (y - prev.point[1]) * t];
			if (prev.point[0] === point[0] && prev.point[1] === point[1]) continue;
			const distance = Math.hypot(point[1] - prev.point[1], point[0] - prev.point[0]);
			this.runningLength += distance;
			if (!this.reached) {
				if (this.runningLength < size) continue;
				this.reached = true;
			}
			const dx = prev.point[0] - point[0];
			const dy = prev.point[1] - point[1];
			const len = Math.hypot(dx, dy);
			const p = points[i * 3 + 2];
			prev = { point, pressure: isValidPressure(p) ? p : DEFAULT_PRESSURE, vector: [dx / len, dy / len], distance, runningLength: this.runningLength };
			this.sp.push(prev);
		}
		this.prev = prev;
		this.consumed = n - 1;
		const g = (n - 2) * 3;
		this.guard = [points[g], points[g + 1], points[g + 2]];
	}

	/** Der letzte Eingabepunkt als vorläufiger Strichpunkt (getStrokePoints, `i === max`); null = deckungsgleich. */
	private tentative(points: number[], n: number): StrokePoint | null {
		const prev = this.prev!;
		const t = this.t;
		const x = points[(n - 1) * 3];
		const y = points[(n - 1) * 3 + 1];
		const point: Vec2 = [prev.point[0] + (x - prev.point[0]) * t, prev.point[1] + (y - prev.point[1]) * t];
		if (prev.point[0] === point[0] && prev.point[1] === point[1]) return null;
		const distance = Math.hypot(point[1] - prev.point[1], point[0] - prev.point[0]);
		const dx = prev.point[0] - point[0];
		const dy = prev.point[1] - point[1];
		const len = Math.hypot(dx, dy);
		const p = points[(n - 1) * 3 + 2];
		return { point, pressure: isValidPressure(p) ? p : DEFAULT_PRESSURE, vector: [dx / len, dy / len], distance, runningLength: this.runningLength + distance };
	}

	/** `points`: alle Strichpunkte, davon die ersten `committed` fest. */
	private outline(points: StrokePoint[], committedPoints: number): number[][] {
		const { size, thinning, smoothing, simulatePressure: simulate } = this.opts!;
		const N = points.length;
		const totalLength = points[N - 1].runningLength;
		const minDistance = Math.pow(size * smoothing, 2);

		// Fest übernehmen, was sich nicht mehr ändern kann (siehe Klassenkommentar).
		if (committedPoints >= INITIAL_PRESSURE_POINTS) {
			if (!this.state) {
				this.initialPressure = initialPressure(points, simulate, size);
				this.state = this.initialState(points, this.initialPressure, size, thinning);
			}
			while (this.oc <= committedPoints - 2 && totalLength - points[this.oc].runningLength >= END_NOISE_THRESHOLD) {
				this.step(points, this.oc, this.state, this.left, this.right, totalLength, minDistance);
				this.oc++;
			}
		}

		// Rest (Ende des Strichs) auf einer Kopie des Zustands
		const committed = this.state !== null;
		const st: OutlineState = committed
			? { ...this.state! }
			: this.initialState(points, initialPressure(points, simulate, size), size, thinning);
		const from = committed ? this.oc : 0;
		const leftT: Vec2[] = [];
		const rightT: Vec2[] = [];
		const leftC = committed ? this.left : [];
		const rightC = committed ? this.right : [];
		for (let i = from; i < N; i++) this.step(points, i, st, leftT, rightT, totalLength, minDistance);

		// Kappen (rund, ohne Verjüngung)
		const firstPoint: Vec2 = [points[0].point[0], points[0].point[1]];
		const last = points[N - 1];
		const lastPoint: Vec2 = [last.point[0], last.point[1]];
		const right0 = rightC.length ? rightC[0] : rightT[0];
		const startCap: Vec2[] = [];
		let step = 1 / START_CAP_SEGMENTS;
		for (let t = step; t <= 1; t += step) startCap.push(rotAround(right0, firstPoint, FIXED_PI * t));
		const direction: Vec2 = [-last.vector[1], last.vector[0]]; // per(neg(v)) = [-v1, -(-v0)]
		const endCap: Vec2[] = [];
		const start: Vec2 = [lastPoint[0] + direction[0] * st.radius, lastPoint[1] + direction[1] * st.radius];
		step = 1 / END_CAP_SEGMENTS;
		for (let t = step; t < 1; t += step) endCap.push(rotAround(start, lastPoint, FIXED_PI * 3 * t));

		// leftPts.concat(endCap, rightPts.reverse(), startCap)
		const out: number[][] = new Array(leftC.length + leftT.length + endCap.length + rightT.length + rightC.length + startCap.length);
		let k = 0;
		for (const p of leftC) out[k++] = p;
		for (const p of leftT) out[k++] = p;
		for (const p of endCap) out[k++] = p;
		for (let i = rightT.length - 1; i >= 0; i--) out[k++] = rightT[i];
		for (let i = rightC.length - 1; i >= 0; i--) out[k++] = rightC[i];
		for (const p of startCap) out[k++] = p;
		return out;
	}

	private initialState(points: StrokePoint[], prevPressure: number, size: number, thinning: number): OutlineState {
		return {
			prevPressure,
			radius: size * (0.5 - thinning * (0.5 - points[points.length - 1].pressure)),
			firstRadius: undefined,
			prevVector: points[0].vector,
			prevLeftPoint: points[0].point,
			prevRightPoint: points[0].point,
			isPrevPointSharpCorner: false,
		};
	}

	/** Ein Durchlauf der Schleife in getStrokeOutlinePoints für Punkt i. */
	private step(points: StrokePoint[], i: number, st: OutlineState, leftPts: Vec2[], rightPts: Vec2[], totalLength: number, minDistance: number) {
		const { size, thinning, simulatePressure: simulate } = this.opts!;
		let { pressure } = points[i];
		const { point, vector, distance, runningLength } = points[i];
		const isLastPoint = i === points.length - 1;
		if (!isLastPoint && totalLength - runningLength < END_NOISE_THRESHOLD) return;

		let radius: number;
		if (thinning) {
			if (simulate) pressure = simulatePressure(st.prevPressure, distance, size);
			radius = size * (0.5 - thinning * (0.5 - pressure));
		} else {
			radius = size / 2;
		}
		if (st.firstRadius === undefined) st.firstRadius = radius;
		// Ohne Verjüngung sind beide Stärken 1: radius * Math.min(1, 1)
		radius = Math.max(MIN_RADIUS, radius * 1);
		st.radius = radius;

		const nextVector = (!isLastPoint ? points[i + 1] : points[i]).vector;
		const nextDpr = !isLastPoint ? vector[0] * nextVector[0] + vector[1] * nextVector[1] : 1.0;
		const prevDpr = vector[0] * st.prevVector[0] + vector[1] * st.prevVector[1];
		const isPointSharpCorner = prevDpr < 0 && !st.isPrevPointSharpCorner;
		const isNextPointSharpCorner = nextDpr !== null && nextDpr < 0;

		if (isPointSharpCorner || isNextPointSharpCorner) {
			// perInto(prevVector) · radius
			const ox = st.prevVector[1] * radius;
			const oy = -st.prevVector[0] * radius;
			const step = 1 / CORNER_CAP_SEGMENTS;
			let tl: Vec2 = st.prevLeftPoint;
			let tr: Vec2 = st.prevRightPoint;
			for (let t = 0; t <= 1; t += step) {
				tl = rotAround([point[0] - ox, point[1] - oy], point, FIXED_PI * t);
				leftPts.push(tl);
				tr = rotAround([point[0] + ox, point[1] + oy], point, FIXED_PI * -t);
				rightPts.push(tr);
			}
			st.prevLeftPoint = tl;
			st.prevRightPoint = tr;
			if (isNextPointSharpCorner) st.isPrevPointSharpCorner = true;
			return;
		}
		st.isPrevPointSharpCorner = false;

		if (isLastPoint) {
			const ox = vector[1] * radius;
			const oy = -vector[0] * radius;
			leftPts.push([point[0] - ox, point[1] - oy]);
			rightPts.push([point[0] + ox, point[1] + oy]);
			return;
		}

		// lrpInto(nextVector, vector, nextDpr) → perInto → mulInto(radius)
		const lx = nextVector[0] + (vector[0] - nextVector[0]) * nextDpr;
		const ly = nextVector[1] + (vector[1] - nextVector[1]) * nextDpr;
		const ox = ly * radius;
		const oy = -lx * radius;

		const tl: Vec2 = [point[0] - ox, point[1] - oy];
		if (i <= 1 || dist2(st.prevLeftPoint, tl) > minDistance) {
			leftPts.push(tl);
			st.prevLeftPoint = tl;
		}
		const tr: Vec2 = [point[0] + ox, point[1] + oy];
		if (i <= 1 || dist2(st.prevRightPoint, tr) > minDistance) {
			rightPts.push(tr);
			st.prevRightPoint = tr;
		}
		st.prevPressure = pressure;
		st.prevVector = vector;
	}
}

function dist2(A: Vec2, B: Vec2): number {
	const dx = A[0] - B[0];
	const dy = A[1] - B[1];
	return dx * dx + dy * dy;
}

/** computeInitialPressure: Mittel über die ersten Punkte gegen „dicke Anfänge“. */
function initialPressure(points: StrokePoint[], simulate: boolean, size: number): number {
	let acc = points[0].pressure;
	const n = Math.min(INITIAL_PRESSURE_POINTS, points.length);
	for (let i = 0; i < n; i++) {
		const curr = points[i];
		const pressure = simulate ? simulatePressure(acc, curr.distance, size) : curr.pressure;
		acc = (acc + pressure) / 2;
	}
	return acc;
}

function triples(points: number[]): number[][] {
	const out: number[][] = [];
	for (let i = 0; i < points.length; i += 3) out.push([points[i], points[i + 1], points[i + 2]]);
	return out;
}
