import type { CtcResult } from "./ctc";
import { alphabetCodes, extendHistory, lmLogProb, type CharLmData } from "./lm";

export interface BeamOptions {
	blank?: number;
	validSteps?: number;
	/** Anzahl der Präfixe, die je Zeitschritt überleben */
	beamWidth?: number;
	/** Gewicht des Sprachmodells */
	alpha?: number;
	/** Bonus je Zeichen (gleicht aus, dass jedes Zeichen das LM-Log-Gewicht senkt) */
	beta?: number;
	lm?: CharLmData | null;
	/** Klassen, deren Log-Wahrscheinlichkeit mehr als das unter der besten liegt, werden ignoriert. */
	prune?: number;
	/** Grammatik für IP-Adressen, Masken und CIDR (siehe `tokenMode`) */
	grammar?: boolean;
}

interface Beam {
	text: string;
	/** log P(Präfix, endet auf Blank) bzw. (…, endet auf Zeichen) */
	pb: number;
	pnb: number;
	/** α·log P_LM + β·Länge, inkl. Grammatik */
	lm: number;
	/** LM-Historie (letzte order − 1 Zeichen) */
	h: number;
	/** zuletzt angehängte Klasse (0 = keine) */
	last: number;
}

const NEG = -Infinity;
function logAdd(a: number, b: number): number {
	if (a === NEG) return b;
	if (b === NEG) return a;
	return a > b ? a + Math.log1p(Math.exp(b - a)) : b + Math.log1p(Math.exp(a - b));
}

const IPV4 = /^\d{1,3}(?:\.\d{0,3}){1,3}(?:\/\d{0,2})?$/;
const IPV6 = /^[0-9a-fA-F]{0,4}(?::[0-9a-fA-F]{0,4}){2,}(?:\/\d{0,3})?$/;
const IPV6_START = /^[0-9a-fA-F]{1,4}:[0-9a-fA-F]{1,4}$/;
const HEX_CHARS = /[0-9a-fA-F:/]/;
const V4_CHARS = /[0-9./]/;

/**
 * Art des laufenden Wortes: In einer IPv4- oder IPv6-Adresse (inkl. Präfixlänge) entscheidet nicht das
 * Sprachmodell, sondern ein Zeichensatz – Ziffern bzw. Hex-Ziffern, Trenner, Leerzeichen am Ende.
 */
export function tokenMode(word: string): "ipv4" | "ipv6" | null {
	if (IPV4.test(word)) return "ipv4";
	if (IPV6.test(word) || (IPV6_START.test(word) && /\d/.test(word))) return "ipv6";
	return null;
}

/** Ersatz für das LM innerhalb einer Adresse: gleichverteilt über die erlaubten Zeichen, alles andere bestraft. */
const ADDR_ALLOWED = Math.log(1 / 18);
const ADDR_PENALTY = -10;

/**
 * CTC-Prefix-Beam-Search mit Zeichen-LM (Shallow Fusion): score = log P_ctc + α·log P_lm + β·|Präfix|.
 * Ohne LM und Grammatik entspricht das Ergebnis praktisch der Greedy-Dekodierung.
 */
export function ctcBeamSearch(
	data: ArrayLike<number>,
	dims: readonly number[],
	alphabet: string,
	options: BeamOptions = {},
): CtcResult {
	const { candidates, confidence } = ctcBeamCandidates(data, dims, alphabet, options);
	const best = candidates[0];
	return { text: (best?.text ?? "").replace(/\s+/g, " ").trim(), confidence };
}

/** Ein überlebender Präfix am Ende der Beam-Search. */
export interface BeamCandidate {
	text: string;
	/** log P_ctc des Präfixes über die im Beam verfolgten Pfade */
	acoustic: number;
	/** α·log P_lm + β·Länge, inkl. Grammatik (wie `prefixScore`) */
	lm: number;
}

/** Wie `ctcBeamSearch`, aber alle überlebenden Präfixe, bestes zuerst (N-Best fürs Ensemble). */
export function ctcBeamCandidates(
	data: ArrayLike<number>,
	dims: readonly number[],
	alphabet: string,
	options: BeamOptions = {},
): { candidates: BeamCandidate[]; confidence: number } {
	const blank = options.blank ?? 0;
	const width = options.beamWidth ?? 16;
	const alpha = options.alpha ?? 0.5;
	const beta = options.beta ?? 1;
	const prune = options.prune ?? 8;
	const lm = options.lm ?? null;
	const grammar = options.grammar ?? true;
	const C = dims[dims.length - 1];
	const T = dims.length === 3 ? (dims[0] === 1 ? dims[1] : dims[0]) : dims[0];
	const steps = Math.min(T, options.validSteps ?? T);
	const chars = Array.from(alphabet);
	const codes = alphabetCodes(alphabet);
	const space = codes.get(" ") ?? 0;

	// Zeichen-Score für das Anhängen von Klasse k an einen Präfix (gecacht je Präfix + Klasse)
	const scoreCache = new Map<string, number>();
	const charScore = (beam: Beam, k: number): number => {
		const key = `${beam.text}\u0000${k}`;
		const cached = scoreCache.get(key);
		if (cached !== undefined) return cached;
		const s = appendScore(beam.text, beam.h, k, chars, { alpha, beta, lm, grammar });
		scoreCache.set(key, s);
		return s;
	};

	let beams: Beam[] = [{ text: "", pb: 0, pnb: NEG, lm: 0, h: space, last: 0 }];
	const logp = new Float64Array(C);
	let probSum = 0;
	for (let t = 0; t < steps; t++) {
		// log-softmax des Frames
		const base = t * C;
		let max = -Infinity;
		for (let c = 0; c < C; c++) max = Math.max(max, data[base + c]);
		let denom = 0;
		for (let c = 0; c < C; c++) denom += Math.exp(data[base + c] - max);
		const logZ = max + Math.log(denom);
		for (let c = 0; c < C; c++) logp[c] = data[base + c] - logZ;
		probSum += 1 / denom;
		const floor = max - logZ - prune;
		const cands: number[] = [];
		for (let c = 0; c < C; c++) if (c !== blank && logp[c] >= floor) cands.push(c);

		const next = new Map<string, Beam>();
		const get = (text: string, from: Beam, k: number, lmScore: number): Beam => {
			let b = next.get(text);
			if (!b) {
				b = { text, pb: NEG, pnb: NEG, lm: lmScore, h: k && lm ? extendHistory(lm, from.h, k) : from.h, last: k || from.last };
				next.set(text, b);
			}
			return b;
		};
		for (const beam of beams) {
			const total = logAdd(beam.pb, beam.pnb);
			// Blank: Präfix bleibt, endet jetzt auf Blank
			const same = get(beam.text, beam, 0, beam.lm);
			same.pb = logAdd(same.pb, total + logp[blank]);
			// Wiederholung des letzten Zeichens ohne Blank dazwischen: Präfix bleibt
			if (beam.last) same.pnb = logAdd(same.pnb, beam.pnb + logp[beam.last]);
			for (const k of cands) {
				const ch = chars[k - 1] ?? "";
				// Leerzeichen am Anfang und doppelte Leerzeichen erzeugen keinen neuen Präfix
				if (ch === " " && (beam.text === "" || beam.text.endsWith(" "))) {
					same.pnb = logAdd(same.pnb, total + logp[k]);
					continue;
				}
				const p = k === beam.last ? beam.pb + logp[k] : total + logp[k];
				if (p === NEG) continue;
				const ext = get(beam.text + ch, beam, k, beam.lm + charScore(beam, k));
				ext.pnb = logAdd(ext.pnb, p);
			}
		}
		beams = [...next.values()];
		if (beams.length > width) {
			const score = (b: Beam) => logAdd(b.pb, b.pnb) + b.lm;
			beams.sort((a, b) => score(b) - score(a));
			beams.length = width;
		}
	}
	const candidates = beams
		.map((b) => ({ text: b.text, acoustic: logAdd(b.pb, b.pnb), lm: b.lm }))
		.sort((a, b) => b.acoustic + b.lm - (a.acoustic + a.lm));
	return { candidates, confidence: steps ? probSum / steps : 0 };
}

interface LmScoring {
	alpha: number;
	beta: number;
	lm: CharLmData | null;
	grammar: boolean;
}

/** Score fürs Anhängen von Klasse k an `prefix` (LM-Historie h): Grammatik in Adressen, sonst α·LM, plus β. */
function appendScore(prefix: string, h: number, k: number, chars: string[], o: LmScoring): number {
	const ch = chars[k - 1] ?? "";
	const mode = o.grammar ? tokenMode(prefix.slice(prefix.lastIndexOf(" ") + 1)) : null;
	let s: number;
	if (mode) {
		const ok = ch === " " || (mode === "ipv6" ? HEX_CHARS : V4_CHARS).test(ch);
		s = o.alpha * (ok ? ADDR_ALLOWED : ADDR_PENALTY);
	} else {
		s = o.lm ? o.alpha * lmLogProb(o.lm, h, k) : 0;
	}
	return s + o.beta;
}

/** LM-/Grammatik-Score eines ganzen Textes, genau wie die Beam-Search ihn Zeichen für Zeichen aufbaut. */
export function prefixScore(text: string, alphabet: string, options: BeamOptions = {}): number {
	const chars = Array.from(alphabet);
	const index = new Map(chars.map((c, i) => [c, i + 1]));
	const lm = options.lm ?? null;
	const o = { alpha: options.alpha ?? 0.5, beta: options.beta ?? 1, lm, grammar: options.grammar ?? true };
	let h = alphabetCodes(alphabet).get(" ") ?? 0;
	let prefix = "";
	let score = 0;
	for (const ch of Array.from(text)) {
		const k = index.get(ch);
		if (k === undefined) return NEG;
		score += appendScore(prefix, h, k, chars, o);
		if (lm) h = extendHistory(lm, h, k);
		prefix += ch;
	}
	return score;
}

/**
 * log P(text | Ausgabe) nach CTC: Summe über alle Ausrichtungen (Vorwärts-Algorithmus). Unabhängig davon, wann
 * genau ein Modell seine Zeichen ausgibt – damit lassen sich Kandidaten verschiedener Modelle fair vergleichen.
 */
export function ctcLogLikelihood(
	data: ArrayLike<number>,
	dims: readonly number[],
	alphabet: string,
	text: string,
	options: { blank?: number; validSteps?: number } = {},
): number {
	const blank = options.blank ?? 0;
	const C = dims[dims.length - 1];
	const T = Math.min(dims.length === 3 ? (dims[0] === 1 ? dims[1] : dims[0]) : dims[0], options.validSteps ?? Infinity);
	const index = new Map(Array.from(alphabet).map((c, i) => [c, i + 1]));
	const labels: number[] = [];
	for (const ch of Array.from(text)) {
		const k = index.get(ch);
		if (k === undefined) return NEG;
		labels.push(k);
	}
	const L = labels.length * 2 + 1;
	const ext = Array.from({ length: L }, (_, i) => (i % 2 ? labels[(i - 1) / 2] : blank));
	if (T <= 0) return labels.length ? NEG : 0;
	let alphaPrev = new Float64Array(L).fill(NEG);
	const lp = (t: number, c: number, logZ: number) => data[t * C + c] - logZ;
	const frameZ = (t: number) => {
		let max = -Infinity;
		for (let c = 0; c < C; c++) max = Math.max(max, data[t * C + c]);
		let sum = 0;
		for (let c = 0; c < C; c++) sum += Math.exp(data[t * C + c] - max);
		return max + Math.log(sum);
	};
	let z = frameZ(0);
	alphaPrev[0] = lp(0, ext[0], z);
	if (L > 1) alphaPrev[1] = lp(0, ext[1], z);
	for (let t = 1; t < T; t++) {
		z = frameZ(t);
		const cur = new Float64Array(L).fill(NEG);
		// Nur Zustände, die vom Ende aus noch erreichbar sind bzw. vom Anfang her erreicht wurden.
		const lo = Math.max(0, L - 2 * (T - t));
		const hi = Math.min(L - 1, 2 * t + 1);
		for (let s = lo; s <= hi; s++) {
			let a = alphaPrev[s];
			if (s > 0) a = logAdd(a, alphaPrev[s - 1]);
			if (s > 1 && ext[s] !== blank && ext[s] !== ext[s - 2]) a = logAdd(a, alphaPrev[s - 2]);
			if (a !== NEG) cur[s] = a + lp(t, ext[s], z);
		}
		alphaPrev = cur;
	}
	return L > 1 ? logAdd(alphaPrev[L - 1], alphaPrev[L - 2]) : alphaPrev[0];
}
