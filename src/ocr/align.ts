/**
 * Erzwungene CTC-Ausrichtung (Viterbi): Welche Zeitschritte gehören zu welchem Zeichen des erkannten Textes?
 * Daraus werden Wörter mit Position (Zeitschritte → x im Zeilenbild → Doc-Einheiten) und Konfidenz – für das
 * Überprüfen einzelner Wörter im Schreibtraining.
 */

export interface AlignedChar {
	/** Klasse im Alphabet (1-basiert, 0 = Blank) */
	k: number;
	/** erster und letzter + 1 Zeitschritt, an denen der beste Pfad dieses Zeichen ausgibt */
	start: number;
	end: number;
	/** höchste Wahrscheinlichkeit des Zeichens an seinen Zeitschritten (0–1) */
	prob: number;
}

export interface AlignedWord {
	text: string;
	/** Zeitschritte [start, end) – die Grenzen zum Nachbarwort liegen in der Mitte der Lücke. */
	start: number;
	end: number;
	/** Wahrscheinlichkeit des unsichersten Zeichens (0–1) */
	conf: number;
}

const NEG = -Infinity;

/**
 * Bester CTC-Pfad für `text`. `lp` sind Log-Wahrscheinlichkeiten je Zeitschritt ([.., T, C] flach, Schritt t ab
 * t·C). `null`, wenn der Text ein unbekanntes Zeichen enthält oder nicht in die Zeitschritte passt.
 */
export function ctcAlign(
	lp: ArrayLike<number>,
	dims: readonly number[],
	alphabet: string,
	text: string,
	options: { blank?: number; validSteps?: number } = {},
): AlignedChar[] | null {
	const blank = options.blank ?? 0;
	const C = dims[dims.length - 1];
	const T = Math.min(dims.length === 3 ? (dims[0] === 1 ? dims[1] : dims[0]) : dims[0], options.validSteps ?? Infinity);
	const index = new Map(Array.from(alphabet).map((c, i) => [c, i + 1]));
	const labels: number[] = [];
	for (const ch of Array.from(text)) {
		const k = index.get(ch);
		if (k === undefined) return null;
		labels.push(k);
	}
	if (!labels.length) return [];
	const L = labels.length * 2 + 1;
	if (T <= 0) return null;
	const ext = Array.from({ length: L }, (_, i) => (i % 2 ? labels[(i - 1) / 2] : blank));
	// Rückzeiger: wie viele Zustände der beste Vorgänger zurückliegt (0, 1 oder 2).
	const back = new Uint8Array(T * L);
	let prev = new Float64Array(L).fill(NEG);
	prev[0] = lp[ext[0]];
	if (L > 1) prev[1] = lp[ext[1]];
	for (let t = 1; t < T; t++) {
		const cur = new Float64Array(L).fill(NEG);
		const lo = Math.max(0, L - 2 * (T - t));
		const hi = Math.min(L - 1, 2 * t + 1);
		for (let s = lo; s <= hi; s++) {
			let best = prev[s];
			let step = 0;
			if (s > 0 && prev[s - 1] > best) {
				best = prev[s - 1];
				step = 1;
			}
			if (s > 1 && ext[s] !== blank && ext[s] !== ext[s - 2] && prev[s - 2] > best) {
				best = prev[s - 2];
				step = 2;
			}
			if (best === NEG) continue;
			cur[s] = best + lp[t * C + ext[s]];
			back[t * L + s] = step;
		}
		prev = cur;
	}
	let s = L > 1 && prev[L - 2] > prev[L - 1] ? L - 2 : L - 1;
	if (prev[s] === NEG) return null;
	const chars: AlignedChar[] = labels.map((k) => ({ k, start: -1, end: -1, prob: 0 }));
	for (let t = T - 1; t >= 0; t--) {
		if (s % 2) {
			const c = chars[(s - 1) / 2];
			if (c.end < 0) c.end = t + 1;
			c.start = t;
			c.prob = Math.max(c.prob, Math.exp(lp[t * C + ext[s]]));
		}
		if (t > 0) s -= back[t * L + s];
	}
	return chars.every((c) => c.start >= 0) ? chars : null;
}

/**
 * Wörter des Textes mit ihren Zeitschritten. Die Grenze zwischen zwei Wörtern liegt in der Mitte zwischen dem
 * letzten Zeichen des einen und dem ersten des nächsten; das erste Wort beginnt bei 0, das letzte endet bei T.
 */
export function alignWords(
	lp: ArrayLike<number>,
	dims: readonly number[],
	alphabet: string,
	text: string,
	options: { blank?: number; validSteps?: number } = {},
): AlignedWord[] | null {
	const chars = ctcAlign(lp, dims, alphabet, text, options);
	if (!chars) return null;
	const glyphs = Array.from(text);
	const words: { text: string; first: number; last: number; conf: number }[] = [];
	let cur: (typeof words)[number] | null = null;
	glyphs.forEach((g, i) => {
		if (g === " ") {
			cur = null;
			return;
		}
		const c = chars[i];
		if (!cur) {
			cur = { text: "", first: c.start, last: c.end, conf: 1 };
			words.push(cur);
		}
		cur.text += g;
		cur.last = c.end;
		cur.conf = Math.min(cur.conf, c.prob);
	});
	const C = dims[dims.length - 1];
	const T = Math.min(Math.floor(lp.length / C), options.validSteps ?? Infinity);
	return words.map((w, i) => ({
		text: w.text,
		start: i === 0 ? 0 : (words[i - 1].last + w.first) / 2,
		end: i === words.length - 1 ? T : (w.last + words[i + 1].first) / 2,
		conf: w.conf,
	}));
}
