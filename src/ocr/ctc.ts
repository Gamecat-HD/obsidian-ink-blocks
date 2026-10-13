export interface CtcResult {
	text: string;
	/** Mittlere Wahrscheinlichkeit der gewählten Klassen (0–1). */
	confidence: number;
}

/**
 * Greedy-CTC-Dekodierung. Die Ausgabe hat die Form [1, T, C] (v2) oder [T, 1, C] (v1) – bei Batch 1
 * ist der flache Index in beiden Fällen `t * C + c`. Klasse k ≙ alphabet[k − 1], Blank = `blank`.
 */
export function ctcGreedy(
	data: ArrayLike<number>,
	dims: readonly number[],
	alphabet: string,
	options: { blank?: number; validSteps?: number } = {},
): CtcResult {
	const blank = options.blank ?? 0;
	const C = dims[dims.length - 1];
	const T = dims.length === 3 ? (dims[0] === 1 ? dims[1] : dims[0]) : dims[0];
	const steps = Math.min(T, options.validSteps ?? T);
	const chars = Array.from(alphabet);

	let text = "";
	let prev = blank;
	let probSum = 0;
	for (let t = 0; t < steps; t++) {
		const base = t * C;
		let best = 0;
		let bestV = -Infinity;
		for (let c = 0; c < C; c++) {
			const v = data[base + c];
			if (v > bestV) {
				bestV = v;
				best = c;
			}
		}
		// Softmax-Wahrscheinlichkeit der besten Klasse (funktioniert für Logits und Log-Probs)
		let denom = 0;
		for (let c = 0; c < C; c++) denom += Math.exp(data[base + c] - bestV);
		probSum += 1 / denom;
		if (best !== prev && best !== blank) text += chars[best - 1] ?? "";
		prev = best;
	}
	return { text: text.replace(/\s+/g, " ").trim(), confidence: steps ? probSum / steps : 0 };
}
