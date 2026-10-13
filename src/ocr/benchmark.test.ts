import { describe, expect, it } from "vitest";
import { findInkFences } from "../block/locate";
import { BENCHMARK_PROMPTS, benchmarkNote, benchmarkReport, cer, editDistance, parseBenchmark, upsertReport } from "./benchmark";

describe("editDistance/cer", () => {
	it("Levenshtein auf Codepoints", () => {
		expect(editDistance("kitten", "sitting")).toBe(3);
		expect(editDistance("Größe", "Grösse")).toBe(2);
		expect(editDistance("", "abc")).toBe(3);
	});
	it("CER relativ zur Vorgabe, Leerraum normalisiert", () => {
		expect(cer("Hallo Welt", "Hallo  Welt ")).toBe(0);
		expect(cer("Hallo Welt", "Hall0 Welt")).toBeCloseTo(0.1);
		expect(cer("", "x")).toBe(0);
	});
});

describe("Messnotiz", () => {
	const paths = BENCHMARK_PROMPTS.map((_, i) => `_ink/m-${i}.ink`);
	const note = benchmarkNote(paths, "2026-10-13");

	it("enthält alle Vorgaben mit je einem Block", () => {
		const items = parseBenchmark(note, findInkFences(note));
		expect(items).toHaveLength(30);
		expect(items[3]).toMatchObject({ n: 4, prompt: "IPv6-Adresse: 2001:db8::1", inkPath: "_ink/m-3.ink" });
	});

	it("Bericht: Gesamt-CER nur über geschriebene Zeilen, Pipes maskiert", () => {
		const report = benchmarkReport(
			[
				{ n: 1, prompt: "Hallo Welt", recognized: "Hall0 Welt" },
				{ n: 2, prompt: "a | b", recognized: "a | b" },
				{ n: 3, prompt: "leer", recognized: "" },
			],
			"htr-v2@b576a0a1",
			"2026-10-13",
		);
		expect(report).toContain("**Gesamt-CER: 6,7 %**"); // 1 Fehler / 15 Zeichen
		expect(report).toContain("| 1 | Hallo Welt | Hall0 Welt | 10,0 % |");
		expect(report).toContain("| 2 | a \\| b | a \\| b | 0,0 % |");
		expect(report).toContain("| 3 | leer | – | – |");
		expect(report).toContain("2/3 Zeilen geschrieben");
	});

	it("upsertReport ersetzt einen vorhandenen Ergebnis-Abschnitt", () => {
		const once = upsertReport(note, "## Ergebnis\n\nalt\n");
		const twice = upsertReport(once, "## Ergebnis\n\nneu\n");
		expect(twice).toContain("neu");
		expect(twice).not.toContain("alt");
		expect(twice.match(/## Ergebnis/g)).toHaveLength(1);
		expect(parseBenchmark(twice, findInkFences(twice))).toHaveLength(30);
	});
});
