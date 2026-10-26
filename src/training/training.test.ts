import { describe, expect, it } from "vitest";
import { BASE_WORDS, nextPrompt, numberPrompt, vaultWords } from "./prompts";
import { charErrors, dedupeSamples, encodeSample, isHoldout, labeled, parseSamples, sampleStats, weakChars, type TrainingSample } from "./samples";

function seeded(seed: number) {
	let s = seed;
	return () => ((s = (s * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
}

const sample = (over: Partial<TrainingSample> = {}): TrainingSample => ({
	id: "abc",
	text: "Größe",
	got: "Grosse",
	source: "dictation",
	engine: "htr-v2@x",
	strokes: [[1, 2, 0.5, 3.4, 5.6, 0.7]],
	refHeight: 12,
	at: "2026-10-26T12:00:00.000Z",
	device: "desktop",
	...over,
});

describe("Proben", () => {
	it("JSONL hin und zurück (Punkte quantisiert)", () => {
		const [back] = parseSamples(encodeSample(sample()) + "\n");
		expect(back.text).toBe("Größe");
		expect(back.strokes[0]).toEqual([1, 2, expect.closeTo(0.5, 2), 3.4, 5.6, expect.closeTo(0.7, 2)]);
	});

	it("kaputte Zeilen werden übersprungen", () => {
		const text = ["{kaputt", JSON.stringify({ id: 1 }), encodeSample(sample({ id: "ok" }))].join("\n");
		expect(parseSamples(text).map((s) => s.id)).toEqual(["ok"]);
	});

	it("gleicher key: die letzte Probe gilt", () => {
		const list = dedupeSamples([sample({ id: "1", key: "k" }), sample({ id: "2" }), sample({ id: "3", key: "k" })]);
		expect(list.map((s) => s.id)).toEqual(["2", "3"]);
	});

	it("„kein Text“ zählt nicht als beschriftet", () => {
		expect(labeled([sample({ text: null }), sample({ id: "x" })]).map((s) => s.id)).toEqual(["x"]);
	});

	it("Holdout ist fest und etwa jede fünfte", () => {
		const ids = Array.from({ length: 500 }, (_, i) => `id${i}`);
		const share = ids.filter(isHoldout).length / ids.length;
		expect(share).toBeGreaterThan(0.12);
		expect(share).toBeLessThan(0.28);
		expect(isHoldout("id7")).toBe(isHoldout("id7"));
	});
});

describe("Zeichenfehler", () => {
	it("Ersetzung und Auslassung zählen beim Soll-Zeichen", () => {
		const e = charErrors("Größe", "Grose");
		expect(e.get("ö")).toEqual({ errors: 1, total: 1 });
		expect(e.get("ß")).toEqual({ errors: 1, total: 1 });
		expect(e.get("G")).toEqual({ errors: 0, total: 1 });
	});

	it("schwache Zeichen erst ab genug Vorkommen", () => {
		const list = [sample({ id: "1" }), sample({ id: "2" }), sample({ id: "3" })];
		const weak = weakChars(list);
		expect(weak.get("ö")).toBe(1);
		expect(weak.has("G")).toBe(false);
	});

	it("Statistik", () => {
		const s = sampleStats([sample({ id: "1", text: "ab", got: "ab" }), sample({ id: "2", text: "ab", got: "ax", source: "review" })]);
		expect(s).toEqual({ count: 2, dictation: 1, review: 1, cer: 0.25 });
	});
});

describe("Vorgaben", () => {
	it("Vault-Wörter: nur Buchstaben, Satzzeichen ab", () => {
		const f = vaultWords(["Der Router, der Router!", "IP 10.0.0.1 und x"]);
		expect(f.get("Router")).toBe(2);
		expect(f.has("10.0.0.1")).toBe(false);
		expect(f.has("x")).toBe(false);
	});

	it("1–3 Wörter, ohne Wiederholung der letzten Vorgaben", () => {
		const words = new Map(Array.from({ length: 40 }, (_, i) => [`Wort${"abcdefghijklmnopqrstuvwxyzäöüßABCDEFGHIJKLMN"[i]}x`, i + 1]));
		const random = seeded(3);
		for (let i = 0; i < 50; i++) {
			const p = nextPrompt({ words, hotwords: ["Subnetz"], weak: new Map(), random });
			expect(p.length).toBeGreaterThan(0);
			expect(p.split(" ").length).toBeLessThanOrEqual(3);
		}
		const recent = new Set(BASE_WORDS.slice(1));
		const only = nextPrompt({ words: new Map(), hotwords: [], weak: new Map(), random: () => 0.7 }, recent);
		expect(only.split(" ").every((w) => w === BASE_WORDS[0])).toBe(true);
	});

	it("schwache Zeichen kommen öfter dran", () => {
		const words = new Map<string, number>(Array.from({ length: 30 }, (_, i) => [`Wort${String.fromCharCode(97 + (i % 26))}${i}`, 5]));
		words.set("Größe", 5);
		const count = (weak: Map<string, number>) => {
			const random = seeded(11);
			let n = 0;
			for (let i = 0; i < 400; i++) if (nextPrompt({ words, hotwords: [], weak, random }).includes("Größe")) n++;
			return n;
		};
		expect(count(new Map([["ö", 1], ["ß", 1]]))).toBeGreaterThan(count(new Map()) * 2);
	});

	it("Zahlen und Adressen", () => {
		const random = seeded(5);
		for (let i = 0; i < 30; i++) expect(numberPrompt(random)).toMatch(/[0-9a-f]/);
	});
});
