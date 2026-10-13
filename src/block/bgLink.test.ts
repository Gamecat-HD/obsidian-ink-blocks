import { describe, expect, it } from "vitest";
import { formatBgLink, linkMatchesPath, parseBgLink } from "./bgLink";

describe("parseBgLink", () => {
	it("Obsidian-Link mit Seite", () => {
		expect(parseBgLink("[[_materialien/pdfs/X.pdf#page=2]]")).toEqual({ linkpath: "_materialien/pdfs/X.pdf", page: 2 });
	});
	it("Embed mit Alias, Seite außerhalb der Klammern, ohne Klammern", () => {
		expect(parseBgLink("![[X.pdf#page=3|Blatt]]")).toEqual({ linkpath: "X.pdf", page: 3 });
		expect(parseBgLink("[[X.pdf]]#page=4")).toEqual({ linkpath: "X.pdf", page: 4 });
		expect(parseBgLink(" X.pdf#page=5 ")).toEqual({ linkpath: "X.pdf", page: 5 });
	});
	it("Bild ohne Seite, Seite 0 → 1", () => {
		expect(parseBgLink("[[bilder/blatt.png]]")).toEqual({ linkpath: "bilder/blatt.png" });
		expect(parseBgLink("[[X.pdf#page=0]]")).toEqual({ linkpath: "X.pdf", page: 1 });
	});
	it("leer/ungültig", () => {
		expect(parseBgLink(undefined)).toBeNull();
		expect(parseBgLink("[[]]")).toBeNull();
		expect(parseBgLink("[[#page=2]]")).toBeNull();
	});
	it("Round-Trip mit formatBgLink", () => {
		expect(parseBgLink(formatBgLink("a/b.pdf", 7))).toEqual({ linkpath: "a/b.pdf", page: 7 });
		expect(formatBgLink("b.png")).toBe("[[b.png]]");
	});
});

describe("linkMatchesPath", () => {
	it("voller Pfad oder Pfad-Suffix", () => {
		expect(linkMatchesPath("_materialien/x.pdf", "_materialien/x.pdf")).toBe(true);
		expect(linkMatchesPath("x.pdf", "_materialien/x.pdf")).toBe(true);
		expect(linkMatchesPath("y.pdf", "_materialien/x.pdf")).toBe(false);
		expect(linkMatchesPath("x.pdf", "_materialien/ax.pdf")).toBe(false);
	});
});
