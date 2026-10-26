import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, normalizeSettings } from "./settingsData";

describe("Einstellungen", () => {
	it("leere Daten → Defaults", () => {
		expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
	});
	it("Daten aus v0.1 (2 Breiten, keine Abstände) bleiben gültig", () => {
		const s = normalizeSettings({ bgStyle: "grid", tools: { tool: "hl", penColor: 1, hlColor: 4, penWidth: 1, hlWidth: 1 } } as never);
		expect(s.bgStyle).toBe("grid");
		expect(s.tools).toEqual({ tool: "hl", penColor: 1, hlColor: 4, penWidth: 1, hlWidth: 1, eraserWidth: 1, tapeColor: 6, tapeWidth: 0 });
		expect(s.eraserMode).toBe("stroke");
		expect(s.penSizes).toEqual([2.6, 4.6, 7]);
		expect(s.ruledGap).toBe(40);
	});
	it("kaputte Werte werden ersetzt bzw. begrenzt", () => {
		const s = normalizeSettings({ ruledGap: 500, gridGap: Number.NaN, penSizes: [1, 2] as never, hlSizes: [100, 20, 30], tools: { penWidth: 7 } } as never);
		expect(s.ruledGap).toBe(80);
		expect(s.gridGap).toBe(25);
		expect(s.penSizes).toEqual([2.6, 4.6, 7]);
		expect(s.hlSizes).toEqual([60, 20, 30]);
		expect(s.tools.penWidth).toBe(0);
	});
	it("eigene Farben: nur #rrggbb, höchstens vier je Werkzeug", () => {
		const s = normalizeSettings({
			customColors: { pen: ["#112233", "rot", "#445566", "#778899", "#aabbcc", "#ddeeff"], hl: "kaputt" },
			tools: { penColor: "#112233", hlColor: "blau" },
		} as never);
		expect(s.customColors).toEqual({ pen: ["#112233", "#445566", "#778899", "#aabbcc"], hl: [], tape: [] });
		expect(s.tools.penColor).toBe("#112233");
		expect(s.tools.hlColor).toBe(3);
	});
	it("Abstimmung: nur mit gültigen Zahlen, auf sinnvolle Grenzen gekappt", () => {
		expect(normalizeSettings({}).ocrTuned).toBeNull();
		expect(normalizeSettings({ ocrTuned: { weight: "x" } } as never).ocrTuned).toBeNull();
		const t = normalizeSettings({ ocrTuned: { weight: 2, alpha: 0.5, beta: -1, samples: 30, holdout: 6, before: 0.1, after: 0.08, at: "2026-10-26" } }).ocrTuned;
		expect(t).toMatchObject({ weight: 0.95, alpha: 0.5, beta: 0, samples: 30 });
	});
	it("Defaults werden nicht verändert", () => {
		const s = normalizeSettings({});
		s.penSizes[0] = 9;
		expect(DEFAULT_SETTINGS.penSizes[0]).toBe(2.6);
	});
});
