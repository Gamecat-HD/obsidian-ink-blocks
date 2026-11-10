import { describe, expect, it } from "vitest";
import type { Stroke } from "../model/ink-format";
import { ghostHit, layoutGhost, lineLeft, writingFront, type Wrap } from "./layout";
import { textStrokes, textWidth } from "./strokeFont";

/** Ein senkrechter Strich als „Buchstabe“ an Position x. */
function letter(id: string, x: number, y = 100, h = 20): Stroke {
	return { id, tool: "pen", color: 0, size: 3, points: [x, y - h, 0.6, x + 2, y - h / 2, 0.6, x + 4, y, 0.6] };
}
const word = (start: number, n: number, prefix = "s", y = 100) => Array.from({ length: n }, (_, i) => letter(`${prefix}${i}`, start + i * 14, y));

describe("textStrokes", () => {
	it("setzt Striche auf die Grundlinie und schreitet nach rechts", () => {
		const strokes = textStrokes("ab", 10, 100, 0.1);
		expect(strokes.length).toBeGreaterThan(1);
		for (const s of strokes) expect(s.length % 3).toBe(0);
		const ys = strokes.flatMap((s) => s.filter((_, i) => i % 3 === 1));
		expect(Math.max(...ys)).toBeLessThanOrEqual(102);
		expect(Math.min(...ys)).toBeLessThan(100);
	});

	it("gibt Umlauten zwei Punkte", () => {
		expect(textStrokes("ä", 0, 100, 0.1).length).toBe(textStrokes("a", 0, 100, 0.1).length + 2);
	});

	it("schreibt ß als zwei s", () => {
		expect(textWidth("ß")).toBe(textWidth("ss"));
		expect(textStrokes("ß", 0, 100, 0.1).length).toBe(textStrokes("ss", 0, 100, 0.1).length);
	});

	it("überspringt unbekannte Zeichen", () => {
		expect(textStrokes("€", 0, 100, 0.1)).toEqual([]);
		expect(textWidth("€")).toBeGreaterThan(0);
	});
});

describe("writingFront", () => {
	it("liefert das Ende der Zeile, wenn vorne geschrieben wird", () => {
		const all = word(10, 6);
		expect(writingFront(all, all[5])?.strokes.map((s) => s.id)).toContain("s5");
	});

	it("schweigt bei einem nachgetragenen Strich in einem früheren Wort", () => {
		const first = word(10, 4, "a");
		const second = word(81, 4, "b");
		expect(writingFront([...first, ...second], first[1])).toBeNull();
		expect(writingFront([...first, ...second], second[3])).not.toBeNull();
	});

	it("nimmt einen nachgetragenen i-Punkt im letzten Wort mit", () => {
		const w = word(10, 6);
		const dot: Stroke = { id: "dot", tool: "pen", color: 0, size: 3, points: [38, 72, 0.6, 39, 73, 0.6] };
		expect(writingFront([...w, dot], dot)?.strokes.map((s) => s.id)).toContain("s5");
	});

	it("zerschneidet ein Wort nicht an einer normalen Buchstabenlücke", () => {
		// Wie „Gemein“ auf dem Tablet: Die Lücke ist etwa eine halbe Zeilenhöhe groß.
		const w = Array.from({ length: 6 }, (_, i) => letter(`w${i}`, 10 + i * 15));
		expect(writingFront(w, w[5])?.strokes.length).toBe(6);
	});

	it("schweigt, wenn rechts davon noch ein Segment steht", () => {
		const left = word(10, 4, "a");
		const right = word(300, 4, "b");
		expect(writingFront([...left, ...right], left[3])).toBeNull();
		expect(writingFront([...left, ...right], right[3])).not.toBeNull();
	});

	it("nimmt nur die Zeile des Strichs", () => {
		const top = word(10, 4, "a", 100);
		const bottom = word(10, 4, "b", 200);
		const front = writingFront([...top, ...bottom], top[3]);
		expect(front?.strokes.every((s) => s.id.startsWith("a"))).toBe(true);
	});

	it("schneidet lange Zeilen auf das Ende zu", () => {
		const all = word(10, 80);
		const front = writingFront(all, all[79]);
		expect(front!.strokes.length).toBeLessThan(40);
		expect(front!.strokes.some((s) => s.id === "s79")).toBe(true);
	});

	it("nimmt nur das letzte Wort, damit die Erkennung schnell bleibt", () => {
		const first = word(10, 4, "a");
		const second = word(10 + 4 * 14 + 16, 4, "b");
		const front = writingFront([...first, ...second], second[3]);
		expect(front?.strokes.map((s) => s.id).sort()).toEqual(["b0", "b1", "b2", "b3"]);
	});

	it("liefert das Wort davor gesondert", () => {
		const first = word(10, 4, "a");
		const second = word(82, 4, "b");
		const front = writingFront([...first, ...second], second[3]);
		expect(front?.previous.map((s) => s.id).sort()).toEqual(["a0", "a1", "a2", "a3"]);
	});

	it("hat am Zeilenanfang kein Wort davor", () => {
		const all = word(10, 4);
		expect(writingFront(all, all[3])?.previous).toEqual([]);
	});

	it("erkennt gar nicht erst, solange das Wort zu kurz ist", () => {
		const all = [...word(10, 12, "a"), letter("z", 400)];
		expect(writingFront(all, all[all.length - 1])).toBeNull();
	});

	it("ignoriert Textmarker und Formen", () => {
		const all = word(10, 4);
		expect(writingFront(all, { ...all[3], tool: "hl" })).toBeNull();
		expect(writingFront(all, { ...all[3], shape: true })).toBeNull();
	});
});

describe("layoutGhost", () => {
	it("setzt den Rest rechts neben das Wort auf dessen Grundlinie", () => {
		const w = word(10, 4);
		const g = layoutGhost("Kost", "enstelle", w)!;
		const right = Math.max(...w.flatMap((s) => s.points.filter((_, i) => i % 3 === 0)));
		expect(g.minX).toBeGreaterThan(right);
		expect(g.maxY).toBeLessThanOrEqual(103);
		expect(g.maxY).toBeGreaterThan(95);
	});

	it("wächst mit der Breite des Geschriebenen", () => {
		const small = layoutGhost("Kost", "en", word(10, 4))!;
		const wide = layoutGhost("Kost", "en", Array.from({ length: 4 }, (_, i) => letter(`w${i}`, 10 + i * 20)))!;
		expect(wide.maxX - wide.minX).toBeGreaterThan(small.maxX - small.minX);
	});

	it("bleibt bei einem sehr schmalen Wort in vernünftiger Größe", () => {
		const g = layoutGhost("Kost", "en", [letter("a", 10)])!;
		expect(g.maxY - g.minY).toBeGreaterThan(4);
	});

	it("hat ohne Striche kein Ergebnis", () => {
		expect(layoutGhost("Kost", "en", [])).toBeNull();
		expect(layoutGhost("Kost", "€", word(10, 4))).toBeNull();
	});
});

describe("ghostHit", () => {
	const g = layoutGhost("Kost", "enstelle", word(10, 4))!;
	const midY = (g.minY + g.maxY) / 2;

	it("trifft den Vorschlag", () => {
		expect(ghostHit(g, g.maxX, midY)).toBe(true);
	});

	it("lässt links Platz für einen Punkt hinter dem Wort", () => {
		expect(ghostHit(g, g.minX + 1, midY)).toBe(false);
	});

	it("trifft nicht daneben", () => {
		expect(ghostHit(g, g.maxX, g.maxY + 40)).toBe(false);
		expect(ghostHit(g, g.maxX + 40, midY)).toBe(false);
	});
});

describe("Umbruch", () => {
	const wrap = (over: Partial<Wrap> = {}): Wrap => ({ left: 10, right: 200, bottom: 400, step: () => 40, free: () => true, ...over });
	const rows = (g: { strokes: number[][] }) => new Set(g.strokes.map((s) => Math.round(s[1] / 40)));

	it("setzt Wörter, die rechts nicht passen, in die nächste Zeile an den Zeilenanfang", () => {
		const g = layoutGhost("Kost", " wird heute hier verteilt", word(10, 4), undefined, wrap())!;
		expect(g.lines.length).toBeGreaterThan(1);
		expect(g.lines[1].minX).toBeLessThan(g.lines[0].minX);
		expect(g.lines[1].minY).toBeGreaterThan(g.lines[0].maxY - 20);
		expect(rows(g).size).toBeGreaterThan(1);
	});

	it("bleibt einzeilig, wenn alles passt", () => {
		expect(layoutGhost("Kost", " en", word(10, 4), undefined, wrap())!.lines.length).toBe(1);
	});

	it("setzt einen zu langen Wortrest komplett in die nächste Zeile", () => {
		const g = layoutGhost("Kost", "enstellenrechnung", word(150, 4), undefined, wrap({ right: 290 }))!;
		expect(g.lines.length).toBe(1);
		expect(g.minX).toBeLessThan(150);
		expect(g.text).toBe("enstellenrechnung");
	});

	it("überschreibt nichts: Ist die nächste Zeile belegt, endet der Vorschlag vorher", () => {
		const g = layoutGhost("Kost", " wird heute hier verteilt", word(10, 4), undefined, wrap({ free: () => false }))!;
		expect(g.lines.length).toBe(1);
		expect(g.text.trim().split(" ").length).toBeLessThan(4);
	});

	it("bleibt auf der Fläche", () => {
		const g = layoutGhost("Kost", " wird heute hier verteilt", word(10, 4), undefined, wrap({ bottom: 110 }))!;
		expect(g.lines.length).toBe(1);
	});

	it("gibt ohne Platz auf", () => {
		expect(layoutGhost("Kost", "enstellenrechnung", word(150, 4), undefined, wrap({ right: 160, bottom: 110 }))).toBeNull();
	});

	it("merkt sich die letzte Zeile fürs Weitermachen", () => {
		const g = layoutGhost("Kost", " wird heute hier verteilt", word(10, 4), undefined, wrap())!;
		expect(g.lastLineFrom).toBeGreaterThan(0);
		expect(g.text.endsWith(g.lastLineText)).toBe(true);
		expect(g.strokes.slice(g.lastLineFrom).every((s) => s[1] > g.lines[0].maxY - 20)).toBe(true);
	});

	it("nimmt auch in der zweiten Zeile an", () => {
		const g = layoutGhost("Kost", " wird heute hier verteilt", word(10, 4), undefined, wrap())!;
		const r = g.lines[1];
		expect(ghostHit(g, (r.minX + r.maxX) / 2, (r.minY + r.maxY) / 2)).toBe(true);
	});
});

describe("lineLeft", () => {
	it("liefert den Anfang der Zeile des Strichs", () => {
		const all = word(25, 4);
		expect(lineLeft(all, all[3])).toBe(25);
		expect(lineLeft(all, letter("x", 500))).toBeNull();
	});
});
