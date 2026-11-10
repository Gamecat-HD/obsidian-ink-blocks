import { describe, expect, it } from "vitest";
import { WordIndex } from "./words";

function indexOf(...entries: [string, number][]) {
	const index = new WordIndex();
	for (const [word, n] of entries) for (let i = 0; i < n; i++) index.add(word);
	return index;
}

describe("WordIndex", () => {
	it("ergänzt zum häufigsten Wort", () => {
		const index = indexOf(["Kostenstelle", 8], ["Kostenträger", 3]);
		expect(index.complete("Kostens")).toMatchObject({ word: "Kostenstelle", rest: "telle" });
		expect(index.complete("Kost")?.word).toBe("Kostenstelle");
	});

	it("schlägt zu seltene Wörter nicht vor", () => {
		expect(indexOf(["Gemeinkosten", 2]).complete("Gemein")).toBeNull();
	});

	it("schweigt bei zu kurzen Anfängen und bei Satzzeichen", () => {
		const index = indexOf(["Kostenstelle", 8]);
		expect(index.complete("Ko")).toBeNull();
		expect(index.complete("Kost,")).toBeNull();
		expect(index.complete("K0st")).toBeNull();
	});

	it("schweigt, wenn das Wort schon fertig aussieht", () => {
		expect(indexOf(["Kosten", 20], ["Kostenstelle", 5]).complete("Kosten")).toBeNull();
	});

	it("schweigt, wenn kein Wort klar vorn liegt", () => {
		const index = indexOf(["Abrechnung", 3], ["Abschreibung", 3], ["Absatzmarkt", 3], ["Abteilung", 3]);
		expect(index.complete("Abr")).not.toBeNull();
		expect(index.complete("Abs")?.word).toBe("Absatzmarkt");
		expect(indexOf(["Aaaaa", 3], ["Aaabb", 3], ["Aaacc", 3], ["Aaadd", 3]).complete("Aaa")).toBeNull();
	});

	it("verlangt mindestens zwei ergänzte Zeichen", () => {
		expect(indexOf(["Haust", 5]).complete("Haus")).toBeNull();
	});

	it("findet am Satzanfang auch kleingeschriebene Wörter", () => {
		expect(indexOf(["verteilen", 6]).complete("Vert")).toMatchObject({ word: "Verteilen", rest: "eilen" });
	});

	it("unterscheidet groß und klein bei kleinem Anfang", () => {
		expect(indexOf(["Kostenstelle", 8]).complete("kost")).toBeNull();
	});

	it("kommt mit Umlauten und Bindestrichen zurecht", () => {
		expect(indexOf(["Übertragung", 5]).complete("Über")?.rest).toBe("tragung");
		expect(indexOf(["Multi-Faktor", 5]).complete("Multi-F")?.rest).toBe("aktor");
	});

	it("zerlegt Zeilen in Wörter und überspringt Zahlen", () => {
		const index = new WordIndex();
		index.add("Die Kosten der Abteilung, die Kosten: 12 Euro");
		expect(index.size).toBe(6);
	});

	it("ergänzt kurze fertige Wörter nicht", () => {
		const index = indexOf(["die", 50], ["diese", 10], ["dieser", 4]);
		expect(index.complete("die")).toBeNull();
		expect(index.complete("Die")).toBeNull();
	});
});

describe("WordIndex mit Kontext", () => {
	function index() {
		const i = new WordIndex();
		for (let n = 0; n < 12; n++) i.add("die Kostenstelle ist wichtig");
		for (let n = 0; n < 3; n++) i.add("variable Kostenarten sind anders");
		return i;
	}

	it("nimmt das Wort, das zum Vorgänger passt, auch wenn ein anderes häufiger ist", () => {
		expect(index().complete("Kost")?.word).toBe("Kostenstelle");
		expect(index().complete("Kost", { previous: "variable" })).toEqual({ word: "Kostenarten", rest: "enarten", byContext: true });
	});

	it("beachtet den Vorgänger unabhängig von der Schreibweise", () => {
		expect(index().complete("Kost", { previous: "Variable" })?.word).toBe("Kostenarten");
	});

	it("ergänzt mit passendem Vorgänger schon ab zwei Buchstaben", () => {
		expect(index().complete("Ko", { previous: "variable" })?.word).toBe("Kostenarten");
		expect(index().complete("Ko")).toBeNull();
		expect(index().complete("Ko", { previous: "unbekannt" })).toBeNull();
	});

	it("schweigt, wenn das Wort nach diesem Vorgänger schon fertig ist", () => {
		const i = new WordIndex();
		for (let n = 0; n < 6; n++) i.add("die Kosten steigen");
		for (let n = 0; n < 2; n++) i.add("die Kostenstelle steigt");
		expect(i.complete("Kosten", { previous: "die" })).toBeNull();
	});

	it("fällt ohne Treffer auf die Häufigkeit zurück", () => {
		expect(index().complete("Kost", { previous: "unbekannt" })).toMatchObject({ word: "Kostenstelle", byContext: false });
	});

	it("bevorzugt Wörter der aktuellen Notiz", () => {
		const note = new Map([["Kostenarten", 4]]);
		expect(index().complete("Kost", { note })?.word).toBe("Kostenarten");
	});

	it("schlägt ein Wort vor, das nur in der Notiz steht", () => {
		const note = new Map([["Vorwärtskalkulation", 2]]);
		expect(new WordIndex().complete("Vorw", { note })).toBeNull();
		const i = new WordIndex();
		i.add("Vorwärtskalkulation");
		expect(i.complete("Vorw", { note })?.word).toBe("Vorwärtskalkulation");
	});
});

describe("WordIndex.phrase", () => {
	function index() {
		const i = new WordIndex();
		for (let n = 0; n < 5; n++) i.add("die Kosten werden verteilt");
		return i;
	}

	it("setzt mit den folgenden Wörtern fort", () => {
		expect(index().phrase("die")).toBe("Kosten werden verteilt");
		expect(index().phrase("Kosten")).toBe("werden verteilt");
	});

	it("schweigt am Ende einer bekannten Wortfolge und bei Unbekanntem", () => {
		expect(index().phrase("verteilt")).toBeNull();
		expect(index().phrase("Haus")).toBeNull();
	});

	it("schweigt, wenn nichts klar vorn liegt", () => {
		const i = new WordIndex();
		for (const w of ["ab", "ca", "de", "fg"]) for (let n = 0; n < 3; n++) i.add(`wort ${w}`);
		expect(i.phrase("wort")).toBeNull();
	});

	it("verlangt mehr als ein einzelnes Vorkommen", () => {
		const i = new WordIndex();
		i.add("selten vorkommend");
		expect(i.phrase("selten")).toBeNull();
	});

	it("läuft sich nicht in einer Schleife fest", () => {
		const i = new WordIndex();
		for (let n = 0; n < 4; n++) i.add("gut gut gut gut");
		expect(i.phrase("gut")).toBe("gut");
	});
});
