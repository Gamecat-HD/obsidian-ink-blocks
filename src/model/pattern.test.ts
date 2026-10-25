import { describe, expect, it } from "vitest";
import { parseGap, patternFields, resolvePattern } from "./pattern";

const D = { bgStyle: "ruled" as const, ruledGap: 40, gridGap: 25 };

describe("Muster", () => {
	it("nimmt Stil und Abstand aus den Einstellungen, wenn der Block nichts sagt", () => {
		expect(resolvePattern({}, D)).toEqual({ style: "ruled", gap: 40, custom: false });
		expect(resolvePattern({ bgStyle: "grid" }, D)).toEqual({ style: "grid", gap: 25, custom: false });
		// Punkteraster: Abstand wie Kästchen
		expect(resolvePattern({ bgStyle: "dots" }, D)).toEqual({ style: "dots", gap: 25, custom: false });
	});
	it("Block-Feld gap überschreibt, ungültige Werte werden ignoriert", () => {
		expect(resolvePattern({ bgStyle: "grid", gap: "18" }, D)).toEqual({ style: "grid", gap: 18, custom: true });
		expect(resolvePattern({ bgStyle: "quatsch", gap: "abc" }, D)).toEqual({ style: "ruled", gap: 40, custom: false });
		expect(parseGap("2")).toBeNull();
		expect(parseGap("500")).toBeNull();
		expect(parseGap(" 30 ")).toBe(30);
	});
	it("Stilwechsel setzt einen eigenen Abstand zurück", () => {
		expect(patternFields({ style: "ruled", gap: 30, custom: true }, { style: "grid" })).toEqual({ bgStyle: "grid", gap: undefined });
		expect(patternFields({ style: "ruled", gap: 40, custom: false }, { style: "grid" })).toEqual({ bgStyle: "grid" });
		expect(patternFields({ style: "ruled", gap: 40, custom: false }, { style: "ruled" })).toEqual({});
	});
	it("Abstand setzen bzw. auf Standard zurück", () => {
		// Eigener Abstand schreibt den Stil mit fest.
		expect(patternFields({ style: "ruled", gap: 40, custom: false }, { gap: 55 })).toEqual({ gap: "55", bgStyle: "ruled" });
		expect(patternFields({ style: "ruled", gap: 55, custom: true }, { gap: null })).toEqual({ gap: undefined });
	});
});
