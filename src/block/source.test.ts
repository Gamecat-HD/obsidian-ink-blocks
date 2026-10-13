import { describe, expect, it } from "vitest";
import { parseBlock, setField, setFields } from "./source";
import { findInkFences, locateInkFence, replaceFenceBody } from "./locate";

const BODY = [
	"file: _ink/2026-10-13-notiz-a1b2.ink",
	'bg: "[[Arbeitsblatt.pdf]]#page=2"',
	"text: |",
	"  erste Zeile",
	"",
	"  dritte Zeile",
	"bgStyle: grid",
].join("\n");

describe("parseBlock", () => {
	it("liest einfache Felder, Anführungszeichen und Textblock", () => {
		expect(parseBlock(BODY)).toEqual({
			file: "_ink/2026-10-13-notiz-a1b2.ink",
			bg: "[[Arbeitsblatt.pdf]]#page=2",
			text: "erste Zeile\n\ndritte Zeile",
			bgStyle: "grid",
		});
	});
	it("verträgt CRLF und leeren Inhalt", () => {
		expect(parseBlock("file: a.ink\r\ntext: |\r\n  x\r\n")).toEqual({ file: "a.ink", text: "x" });
		expect(parseBlock("")).toEqual({});
	});
});

describe("setField", () => {
	it("ersetzt den Textblock und lässt andere Zeilen unverändert", () => {
		const out = setField(BODY, "text", "neu\nzwei");
		expect(out).toBe(
			[
				"file: _ink/2026-10-13-notiz-a1b2.ink",
				'bg: "[[Arbeitsblatt.pdf]]#page=2"',
				"text: |",
				"  neu",
				"  zwei",
				"bgStyle: grid",
			].join("\n"),
		);
	});
	it("hängt fehlende Felder an und entfernt leere", () => {
		expect(setField("file: a.ink", "text", "hi")).toBe("file: a.ink\ntext: |\n  hi");
		expect(setField("file: a.ink\ntext: |\n  hi\n", "text", "")).toBe("file: a.ink\n");
		expect(setField("", "file", "a.ink")).toBe("file: a.ink");
	});
	it("quotet Werte, die YAML missverstehen würde", () => {
		expect(setField("file: a.ink", "bg", "[[x.pdf]]#page=1")).toBe('file: a.ink\nbg: "[[x.pdf]]#page=1"');
		expect(setField("file: a.ink", "bgStyle", "ruled")).toBe("file: a.ink\nbgStyle: ruled");
	});
	it("erhält CRLF", () => {
		expect(setField("file: a.ink\r\nbgStyle: grid\r\n", "bgStyle", "blank")).toBe("file: a.ink\r\nbgStyle: blank\r\n");
	});
	it("Round-Trip: setField → parseBlock", () => {
		const text = "Zeile mit ``` Backticks\n  eingerückt";
		expect(parseBlock(setField(BODY, "text", text)).text).toBe(text);
	});
});

const NOTE = [
	"# Titel",
	"",
	"```ink",
	"file: _ink/a.ink",
	"```",
	"",
	"```js",
	"```ink",
	"file: _ink/fake.ink",
	"```",
	"",
	"~~~~ink",
	"file: _ink/b.ink",
	"text: |",
	"  hallo",
	"~~~~",
	"",
	"```ink",
	"file: _ink/a.ink",
	"```",
].join("\n");

describe("findInkFences/locateInkFence", () => {
	it("findet ```- und ~~~-Blöcke, ignoriert ink-Fences innerhalb anderer Codeblöcke", () => {
		const fences = findInkFences(NOTE);
		expect(fences.map((f) => [f.open, f.close, f.file])).toEqual([
			[2, 4, "_ink/a.ink"],
			[11, 15, "_ink/b.ink"],
			[17, 19, "_ink/a.ink"],
		]);
	});
	it("wählt bei Duplikaten den Block nahe der Hint-Zeile", () => {
		expect(locateInkFence(NOTE, "_ink/a.ink", 18)).toMatchObject({ fence: { open: 17 }, duplicates: 1 });
		expect(locateInkFence(NOTE, "_ink/a.ink", 0)).toMatchObject({ fence: { open: 2 }, duplicates: 1 });
		expect(locateInkFence(NOTE, "_ink/missing.ink")).toBeNull();
	});
	it("ignoriert nicht geschlossene Blöcke", () => {
		expect(findInkFences("```ink\nfile: x.ink\n")).toEqual([]);
	});
	it("replaceFenceBody ersetzt nur den Inhalt", () => {
		const fence = locateInkFence(NOTE, "_ink/b.ink")!.fence;
		const out = replaceFenceBody(NOTE, fence, setField(fence.body, "text", "neu"));
		const lines = out.split("\n");
		expect(lines.slice(11, 16)).toEqual(["~~~~ink", "file: _ink/b.ink", "text: |", "  neu", "~~~~"]);
		expect(lines.length).toBe(NOTE.split("\n").length);
	});
	it("setFields setzt/entfernt mehrere Felder", () => {
		expect(setFields("file: a.ink\nbgStyle: ruled\ngap: 30\n", { bgStyle: "grid", gap: undefined })).toBe("file: a.ink\nbgStyle: grid\n");
	});
});
