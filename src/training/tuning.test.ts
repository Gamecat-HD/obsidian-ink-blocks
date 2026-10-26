import { describe, expect, it } from "vitest";
import type { TuneParams, TuneResult } from "../ocr/protocol";
import { chooseTuning, tuneGrid } from "./tuning";

const current: TuneParams = { weight: 0.7, alpha: 0.35, beta: 1.5 };
const result = (params: TuneParams, tune: number, holdout: number): TuneResult => ({ params, tune: { errors: tune, chars: 100 }, holdout: { errors: holdout, chars: 50 } });

describe("tuneGrid", () => {
	it("mit Ensemble und LM: alle Kombinationen, die aktuellen Werte sind dabei", () => {
		const grid = tuneGrid({ ensemble: true, lm: true }, current);
		expect(grid.length).toBe(5 * 4 * 4);
		expect(grid).toContainEqual(current);
		expect(tuneGrid({ ensemble: true, lm: true }, { weight: 0.6, alpha: 0.35, beta: 1.5 })).toHaveLength(81);
	});

	it("ohne Zweitmodell und LM bleibt nur der aktuelle Punkt mit Anteil 0", () => {
		expect(tuneGrid({ ensemble: false, lm: false }, current)).toEqual([{ weight: 0, alpha: 0.35, beta: 1.5 }]);
	});
});

describe("chooseTuning", () => {
	it("übernimmt, wenn besser und Kontrolle nicht schlechter", () => {
		const c = chooseTuning([result(current, 20, 10), result({ weight: 0.85, alpha: 0.5, beta: 1 }, 12, 9)], current)!;
		expect(c.accept).toBe(true);
		expect(c.best.params.weight).toBe(0.85);
	});

	it("verwirft, wenn die Kontrollproben schlechter werden (Überanpassung)", () => {
		const c = chooseTuning([result(current, 20, 10), result({ weight: 0.3, alpha: 0.2, beta: 2.5 }, 10, 14)], current)!;
		expect(c.accept).toBe(false);
	});

	it("Gleichstand: der aktuelle Punkt bleibt", () => {
		const c = chooseTuning([result({ weight: 0, alpha: 0.2, beta: 0.5 }, 15, 5), result(current, 15, 5)], current)!;
		expect(c.best.params).toEqual(current);
		expect(c.accept).toBe(false);
	});
});
