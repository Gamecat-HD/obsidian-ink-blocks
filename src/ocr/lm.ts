/**
 * Zeichen-n-Gramm-Sprachmodell (Witten-Bell-Interpolation) für die Beam-Search. Es wird aus Text gebaut,
 * typischerweise aus dem eigenen Vault (siehe corpus.ts), und kennt nur Zeichen aus dem Modell-Alphabet.
 *
 * Kodierung: Zeichen k des Alphabets ≙ Code k + 1 (0 bleibt frei, damit Schlüssel eindeutig sind). Ein
 * n-Gramm ist die Zahl Σ code·base^i mit dem jüngsten Zeichen an der niedrigsten Stelle; die Ordnung
 * wird so begrenzt, dass der Schlüssel unter 2^53 bleibt.
 */

export interface CharLmData {
	order: number;
	/** Alphabetgröße + 1 */
	base: number;
	/** Alphabetgröße (ohne Blank) – Basis der Gleichverteilung */
	vocab: number;
	/** n-Gramm-Schlüssel → Anzahl */
	counts: Map<number, number>;
	/** Historie → [Summe der Folgezählungen, Anzahl verschiedener Folgezeichen] */
	hist: Map<number, [number, number]>;
}

export interface LmOptions {
	order?: number;
	/** n-Gramme ab Ordnung 3, die seltener vorkommen, werden verworfen (spart Speicher). */
	minCount?: number;
}

/** Text → Codes; Leerraum wird zu einem Leerzeichen, Zeichen außerhalb des Alphabets entfallen. */
export function encodeText(text: string, codes: Map<string, number>, space: number): number[] {
	const out: number[] = [];
	for (const ch of text) {
		const c = codes.get(ch) ?? (/\s/.test(ch) ? space : 0);
		if (!c || (c === space && (out.length === 0 || out[out.length - 1] === space))) continue;
		out.push(c);
	}
	return out;
}

export function alphabetCodes(alphabet: string): Map<string, number> {
	const codes = new Map<string, number>();
	Array.from(alphabet).forEach((ch, i) => codes.set(ch, i + 1));
	return codes;
}

/** Zählt alle n-Gramme der Ordnungen 1…order über die Zeilen. Jede Zeile beginnt mit einem Leerzeichen als Kontext. */
export function buildCharLm(lines: Iterable<string>, alphabet: string, options: LmOptions = {}): CharLmData {
	const codes = alphabetCodes(alphabet);
	const base = codes.size + 1;
	const order = Math.max(1, Math.min(options.order ?? 6, Math.floor(53 / Math.log2(base))));
	const minCount = options.minCount ?? 2;
	const space = codes.get(" ");
	if (!space) throw new Error("Alphabet ohne Leerzeichen");
	const counts = new Map<number, number>();
	for (const line of lines) {
		const seq = encodeText(line, codes, space);
		if (!seq.length) continue;
		if (seq[0] !== space) seq.unshift(space);
		for (let i = 1; i < seq.length; i++) {
			// alle n-Gramme, die auf Position i enden: seq[i-n+1 … i]
			let key = 0;
			let mult = 1;
			for (let n = 1; n <= order && i - n + 1 >= 0; n++) {
				key += seq[i - n + 1] * mult;
				mult *= base;
				counts.set(key, (counts.get(key) ?? 0) + 1);
			}
		}
	}
	// Seltene lange n-Gramme verwerfen, danach die Historien-Statistik aus den verbliebenen bilden
	const hist = new Map<number, [number, number]>();
	for (const [key, n] of counts) {
		if (n < minCount && key >= base * base) {
			counts.delete(key);
			continue;
		}
		const h = Math.floor(key / base); // ohne das jüngste Zeichen = Historie
		const s = hist.get(h);
		if (s) {
			s[0] += n;
			s[1]++;
		} else hist.set(h, [n, 1]);
	}
	return { order, base, vocab: codes.size, counts, hist };
}

/** Historie um ein Zeichen verlängern und auf `order − 1` Zeichen kürzen. */
export function extendHistory(lm: CharLmData, h: number, code: number): number {
	const max = lm.base ** (lm.order - 1);
	return ((h * lm.base) % max) + code;
}

/** log P(code | Historie) mit Witten-Bell-Interpolation bis zur Gleichverteilung. */
export function lmLogProb(lm: CharLmData, h: number, code: number): number {
	const B = lm.base;
	// Historien von kurz nach lang: leer, letztes Zeichen, die letzten zwei, …
	let p = 1 / lm.vocab;
	let hk = 0;
	let mult = 1;
	for (let n = 1; n <= lm.order; n++) {
		const stats = lm.hist.get(hk);
		if (!stats) break;
		const [total, types] = stats;
		const c = lm.counts.get(hk * B + code) ?? 0;
		p = (c + types * p) / (total + types);
		if (n === lm.order) break;
		const older = Math.floor(h / mult) % B;
		if (!older) break;
		hk += older * mult;
		mult *= B;
	}
	return Math.log(p);
}
