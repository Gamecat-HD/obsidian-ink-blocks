import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, normalizeSettings } from "./settingsData";

describe("Einstellungen", () => {
	it("leere Daten → Defaults", () => {
		expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
	});
	it("Daten aus v0.1 (2 Breiten, keine Abstände) bleiben gültig", () => {
		const s = normalizeSettings({ bgStyle: "grid", tools: { tool: "hl", penColor: 1, hlColor: 4, penWidth: 1, hlWidth: 1 } } as never);
		expect(s.bgStyle).toBe("grid");
		expect(s.tools).toEqual({ tool: "hl", penColor: 1, hlColor: 4, penWidth: 1, hlWidth: 1 });
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
	it("Defaults werden nicht verändert", () => {
		const s = normalizeSettings({});
		s.penSizes[0] = 9;
		expect(DEFAULT_SETTINGS.penSizes[0]).toBe(2.6);
	});
});
