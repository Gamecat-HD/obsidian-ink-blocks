/**
 * Erkennung auf die eigene Schrift abstimmen: Ensemble-Anteil von v1 und die LM-Gewichte α/β über ein Raster
 * prüfen. Gewählt wird auf den Abstimmproben; übernommen nur, wenn die Kontrollproben nicht schlechter werden.
 */
import type { TuneParams, TuneResult } from "../ocr/protocol";

/** Unter so vielen beschrifteten Proben lohnt sich das Abstimmen nicht. */
export const MIN_TUNE_SAMPLES = 20;

export function tuneGrid(setup: { ensemble: boolean; lm: boolean }, current: TuneParams): TuneParams[] {
	const weights = setup.ensemble ? [0, 0.3, 0.5, 0.7, 0.85] : [0];
	const alphas = setup.lm ? [0.2, 0.35, 0.5, 0.7] : [current.alpha];
	const betas = setup.lm ? [0.5, 1, 1.5, 2.5] : [current.beta];
	const grid: TuneParams[] = [];
	for (const weight of weights) for (const alpha of alphas) for (const beta of betas) grid.push({ weight, alpha, beta });
	// Die aktuellen Werte immer mit messen – sie sind der Vergleich.
	const base = { ...current, weight: setup.ensemble ? current.weight : 0 };
	if (!grid.some((p) => same(p, base))) grid.push(base);
	return grid;
}

const same = (a: TuneParams, b: TuneParams) => Math.abs(a.weight - b.weight) < 1e-9 && Math.abs(a.alpha - b.alpha) < 1e-9 && Math.abs(a.beta - b.beta) < 1e-9;
const rate = (b: { errors: number; chars: number }) => (b.chars ? b.errors / b.chars : 0);

export interface TuneChoice {
	best: TuneResult;
	baseline: TuneResult;
	/** Neue Werte übernehmen? (besser auf den Abstimmproben und auf den Kontrollproben nicht schlechter) */
	accept: boolean;
}

/**
 * Beste Kombination auf den Abstimmproben (bei Gleichstand die nächste an den aktuellen Werten), verglichen mit
 * den aktuellen Werten (`baseline`). Ohne Kontrollproben zählt nur die Abstimmung.
 */
export function chooseTuning(results: TuneResult[], current: TuneParams): TuneChoice | null {
	if (!results.length) return null;
	const baseline = results.find((r) => same(r.params, current)) ?? results.find((r) => r.params.weight === 0 && same({ ...r.params, weight: current.weight }, current)) ?? results[0];
	const dist = (p: TuneParams) => Math.abs(p.weight - current.weight) + Math.abs(p.alpha - current.alpha) + Math.abs(p.beta - current.beta) / 5;
	const best = [...results].sort((a, b) => a.tune.errors - b.tune.errors || dist(a.params) - dist(b.params))[0];
	const better = best.tune.errors < baseline.tune.errors;
	const holdoutOk = !best.holdout.chars || rate(best.holdout) <= rate(baseline.holdout);
	return { best, baseline, accept: better && holdoutOk };
}

export function percent(b: { errors: number; chars: number }): string {
	return `${(rate(b) * 100).toFixed(1).replace(".", ",")} %`;
}
