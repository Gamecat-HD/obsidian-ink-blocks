import { describe, expect, it } from "vitest";
import { isPalmContact, resolvePenOnly } from "./profile";

describe("resolvePenOnly", () => {
	it("feste Profile gelten immer", () => {
		expect(resolvePenOnly("pen", false, true, false)).toBe(true);
		expect(resolvePenOnly("finger", true, false, true)).toBe(false);
	});

	it("automatisch: Stift gesehen → nur Stift", () => {
		expect(resolvePenOnly("auto", true, true, false)).toBe(true);
	});

	it("automatisch: Tablet ohne Stift → Finger zeichnen", () => {
		expect(resolvePenOnly("auto", false, true, true)).toBe(false);
	});

	it("automatisch: Desktop ohne Stift → alte Einstellung", () => {
		expect(resolvePenOnly("auto", false, false, true)).toBe(true);
		expect(resolvePenOnly("auto", false, false, false)).toBe(false);
	});
});

describe("isPalmContact", () => {
	it("Finger klein, Handballen groß", () => {
		expect(isPalmContact(10, 12)).toBe(false);
		expect(isPalmContact(60, 30)).toBe(true);
		expect(isPalmContact(NaN, 0)).toBe(false);
	});
});
