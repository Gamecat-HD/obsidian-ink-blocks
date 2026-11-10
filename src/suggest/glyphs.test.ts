import { describe, expect, it } from "vitest";
import { buildGlyphLibrary, GlyphLibrary } from "./glyphs";

/** Kleiner Buchstabe: senkrechter Strich der Höhe `h`, endet auf der Grundlinie y (+ `below`). */
const bar = (x: number, h = 20, y = 100, below = 0) => [x, y - h, 0.6, x + 2, y - h / 2, 0.6, x + 4, y + below, 0.6];
/** Zwei getrennte Striche nebeneinander, wie ein k. */
const twoParts = (x: number, y = 100) => [bar(x, 40, y), [x + 8, y - 20, 0.6, x + 18, y - 10, 0.6, x + 28, y, 0.6]];
const dot = (x: number, y: number) => [x, y, 0.6, x + 1, y + 1, 0.6];

describe("GlyphLibrary.add", () => {
	it("ordnet die Striche eines Wortes den Buchstaben zu", () => {
		const lib = new GlyphLibrary();
		lib.add({ text: "nenn", strokes: [bar(10), bar(30), bar(50), bar(70)] });
		expect(lib.count("n")).toBe(3);
		expect(lib.count("e")).toBe(1);
		expect(lib.wordsUsed).toBe(1);
	});

	it("lässt Wörter aus, deren Strichzahl nicht passt", () => {
		const lib = new GlyphLibrary();
		lib.add({ text: "nenn", strokes: [bar(10), bar(30), bar(50)] });
		expect(lib.count("n")).toBe(0);
		expect(lib.wordsSkipped).toBe(1);
	});

	it("hängt den i-Punkt an seinen Buchstaben", () => {
		const lib = new GlyphLibrary();
		lib.add({ text: "nin", strokes: [bar(10), bar(30), bar(50), dot(36, 70)] });
		expect(lib.count("i")).toBe(1);
		expect(lib.count("n")).toBe(2);
	});

	it("trennt Wörter an den größten Lücken", () => {
		const lib = new GlyphLibrary();
		lib.add({ text: "nn ee", strokes: [bar(10), bar(30), bar(120), bar(140)] });
		expect(lib.count("n")).toBe(2);
		expect(lib.count("e")).toBe(2);
	});

	it("verwirft Wörter, in denen die Form nicht zum Buchstaben passt", () => {
		const lib = new GlyphLibrary();
		// Das „h“ ist so hoch wie die kleinen Buchstaben: Die Zuordnung ist verrutscht.
		lib.add({ text: "nhn", strokes: [bar(10), bar(30), bar(50)] });
		expect(lib.count("h")).toBe(0);
	});

	it("verlangt bei g eine Unterlänge", () => {
		const lib = new GlyphLibrary();
		lib.add({ text: "ngn", strokes: [bar(10), bar(30, 30, 100, 10), bar(50)] });
		expect(lib.count("g")).toBe(1);
		const flat = new GlyphLibrary();
		flat.add({ text: "ngn", strokes: [bar(10), bar(30), bar(50)] });
		expect(flat.count("g")).toBe(0);
	});
});

describe("einzeln geschriebene Buchstaben", () => {
	it("fasst getrennte Striche eines Buchstabens zusammen", () => {
		const lib = new GlyphLibrary();
		lib.add({ text: "k k n", strokes: [...twoParts(10), ...twoParts(100), bar(190)] });
		expect(lib.count("k")).toBe(2);
		const g = lib.glyph("k", 0)!;
		expect(g.strokes.length).toBe(2);
		expect(g.width).toBeGreaterThan(1);
	});

	it("bevorzugt einzeln geschriebene vor ausgeschnittenen", () => {
		const lib = new GlyphLibrary();
		for (let i = 0; i < 3; i++) lib.add({ text: "nkn", strokes: [bar(10), bar(30, 40), bar(50)] });
		lib.add({ text: "k k n", strokes: [...twoParts(10), ...twoParts(100), bar(190)] });
		expect(lib.glyph("k", 0)!.isolated).toBe(true);
	});

	it("nimmt die Größe aus dem Bezugsbuchstaben der Probe", () => {
		const lib = new GlyphLibrary();
		lib.add({ text: "A A n", strokes: [bar(10, 60), bar(100, 60), bar(190)] });
		expect(lib.glyph("A", 0)!.height).toBeCloseTo(3);
	});
});

describe("Auswahl der Varianten", () => {
	it("braucht mindestens zwei Beispiele", () => {
		const lib = new GlyphLibrary();
		lib.add({ text: "nen", strokes: [bar(10), bar(30), bar(50)] });
		expect(lib.glyph("e", 0)).toBeNull();
		expect(lib.glyph("n", 0)).not.toBeNull();
	});

	it("wirft eine falsch zugeordnete Form hinaus", () => {
		const lib = new GlyphLibrary();
		const zigzag = (x: number) => [x, 80, 0.6, x + 12, 100, 0.6, x + 24, 80, 0.6, x + 36, 100, 0.6];
		for (let i = 0; i < 6; i++) lib.add({ text: "nen", strokes: [bar(10), bar(30), bar(50)] });
		lib.add({ text: "nen", strokes: [bar(10), zigzag(30), bar(80)] });
		for (let i = 0; i < 4; i++) expect(lib.glyph("e", i)!.width).toBeLessThan(1);
	});

	it("wechselt zwischen den Varianten", () => {
		const lib = new GlyphLibrary();
		lib.add({ text: "nen", strokes: [bar(10, 20), bar(30, 20), bar(50, 20)] });
		lib.add({ text: "nen", strokes: [bar(10, 22), bar(30, 22), bar(50, 22)] });
		expect(lib.glyph("n", 0)).not.toBe(lib.glyph("n", 1));
	});
});

describe("Darstellung", () => {
	function full() {
		const lib = new GlyphLibrary();
		for (let i = 0; i < 3; i++) lib.add({ text: "nen", strokes: [bar(10), bar(30), bar(50)] });
		return lib;
	}

	it("setzt Buchstaben von links nach rechts auf die Grundlinie", () => {
		const out = full().render("nn", 100, 200, 20);
		expect(out.length).toBe(2);
		expect(out[1][0]).toBeGreaterThan(out[0][0]);
		expect(out[0][out[0].length - 2]).toBeCloseTo(200);
	});

	it("nimmt für fehlende Buchstaben die Druckschrift", () => {
		const lib = full();
		expect(lib.render("Z", 0, 0, 20).length).toBeGreaterThan(0);
		expect(lib.width("Z")).toBeGreaterThan(0);
	});

	it("baut Umlaute aus dem eigenen Grundbuchstaben", () => {
		const lib = new GlyphLibrary();
		for (let i = 0; i < 3; i++) lib.add({ text: "nan", strokes: [bar(10), bar(30), bar(50)] });
		expect(lib.render("ä", 0, 0, 20).length).toBe(lib.render("a", 0, 0, 20).length + 2);
	});

	it("schreibt ß als ss, solange es keins gibt", () => {
		const lib = full();
		expect(lib.width("ß")).toBeCloseTo(lib.width("ss"));
	});

	it("lässt für ein Leerzeichen Platz", () => {
		const lib = full();
		expect(lib.width("n n")).toBeGreaterThan(lib.width("nn"));
		expect(lib.render(" ", 0, 0, 20)).toEqual([]);
	});

	it("funktioniert ohne jede Probe", () => {
		const lib = new GlyphLibrary();
		expect(lib.render("Haus", 0, 0, 20).length).toBeGreaterThan(0);
	});
});

describe("needsPractice", () => {
	it("nennt fehlende und seltene Buchstaben", () => {
		const lib = new GlyphLibrary();
		lib.add({ text: "nen", strokes: [bar(10), bar(30), bar(50)] });
		expect(lib.needsPractice("q")).toBe(true);
		expect(lib.needsPractice("e")).toBe(true);
	});

	it("verlangt k und t immer einzeln", () => {
		const lib = new GlyphLibrary();
		for (let i = 0; i < 8; i++) lib.add({ text: "nkn", strokes: [bar(10), bar(30, 40), bar(50)] });
		expect(lib.needsPractice("k")).toBe(true);
		lib.add({ text: "k k n", strokes: [...twoParts(10), ...twoParts(100), bar(190)] });
		expect(lib.needsPractice("k")).toBe(false);
	});

	it("lässt häufige Buchstaben in Ruhe", () => {
		const lib = new GlyphLibrary();
		for (let i = 0; i < 4; i++) lib.add({ text: "nen", strokes: [bar(10), bar(30), bar(50)] });
		expect(lib.needsPractice("n")).toBe(false);
	});
});

describe("buildGlyphLibrary", () => {
	it("überspringt Proben ohne Text", () => {
		const lib = buildGlyphLibrary([{ text: null, strokes: [bar(10)] }, { text: "  ", strokes: [bar(10)] }, { text: "nn", strokes: [bar(10), bar(30)] }]);
		expect(lib.count("n")).toBe(2);
	});
});
