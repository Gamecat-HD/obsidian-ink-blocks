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
		const ch = chars[k - 1] ?? "";
		const key = `${beam.text}\u0000${k}`;
		const cached = scoreCache.get(key);
		if (cached !== undefined) return cached;
		let s: number;
		const mode = grammar ? tokenMode(beam.text.slice(beam.text.lastIndexOf(" ") + 1)) : null;
		if (mode) {
			const ok = ch === " " || (mode === "ipv6" ? HEX_CHARS : V4_CHARS).test(ch);
			s = alpha * (ok ? ADDR_ALLOWED : ADDR_PENALTY);
		} else {
			s = lm ? alpha * lmLogProb(lm, beam.h, k) : 0;
		}
		s += beta;
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
	let best = beams[0];
	let bestScore = NEG;
	for (const b of beams) {
		const s = logAdd(b.pb, b.pnb) + b.lm;
		if (s > bestScore) {
			bestScore = s;
			best = b;
		}
	}
	return { text: best.text.replace(/\s+/g, " ").trim(), confidence: steps ? probSum / steps : 0 };
}
