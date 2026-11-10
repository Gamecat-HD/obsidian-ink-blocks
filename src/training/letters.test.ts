import { describe, expect, it } from "vitest";
import { letterPrompts } from "./prompts";
import { labeled, parseSamples, type TrainingSample } from "./samples";

describe("letterPrompts", () => {
	it("schreibt je zwei Buchstaben doppelt und endet mit dem Maß n", () => {
		expect(letterPrompts((ch) => ch === "q" || ch === "A")).toEqual(["q q A A n"]);
	});

	it("kommt mit einer ungeraden Anzahl zurecht", () => {
		expect(letterPrompts((ch) => ch === "q" || ch === "x" || ch === "A")).toEqual(["q q x x n", "A A n"]);
	});

	it("ist leer, wenn nichts fehlt", () => {
		expect(letterPrompts(() => false)).toEqual([]);
	});
});

describe("Buchstaben-Proben", () => {
	const sample = (source: string): TrainingSample =>
		({ id: "a", text: "q q n", got: "", source, engine: "", strokes: [[0, 0, 0.5]], refHeight: 10, at: "", device: "mobile" }) as TrainingSample;

	it("zählen nicht für die Texterkennung", () => {
		expect(labeled([sample("letters")])).toEqual([]);
		expect(labeled([sample("dictation")]).length).toBe(1);
	});

	it("behalten beim Einlesen ihre Quelle", () => {
		const line = JSON.stringify({ id: "a", text: "q q n", got: "", source: "letters", engine: "", p: [[0, 0, 128]], refHeight: 10, at: "", device: "mobile" });
		expect(parseSamples(line)[0].source).toBe("letters");
	});
});
