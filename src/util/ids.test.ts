import { describe, expect, it } from "vitest";
import { inkFileName, shortId, slugify } from "./ids";
import { fnv1a, sha256Hex } from "./hash";

describe("slugify", () => {
	it("schreibt Umlaute aus und entfernt Sonderzeichen", () => {
		expect(slugify("Größe & Übermaß: IPv6 (Arbeitsblatt)")).toBe("groesse-uebermass-ipv6-arbeitsblatt");
	});
	it("entfernt Akzente und begrenzt die Länge ohne Bindestrich am Ende", () => {
		expect(slugify("Café")).toBe("cafe");
		expect(slugify("a".repeat(30) + " " + "b".repeat(30), 31)).toBe("a".repeat(30));
	});
	it("liefert leer für reine Sonderzeichen", () => {
		expect(slugify("!!!")).toBe("");
	});
});

describe("inkFileName", () => {
	it("baut Datum, Slug und ID zusammen", () => {
		expect(inkFileName(new Date(2026, 9, 3), "04 IPv6 Übung", "a1b2")).toBe("2026-10-03-04-ipv6-uebung-a1b2.ink");
		expect(inkFileName(new Date(2026, 0, 1), "???", "zz00")).toBe("2026-01-01-notiz-zz00.ink");
	});
});

describe("shortId", () => {
	it("erzeugt base36-IDs der gewünschten Länge", () => {
		expect(shortId(6)).toMatch(/^[0-9a-z]{6}$/);
		expect(shortId(3, () => 0.999)).toBe("zzz");
	});
});

describe("hash", () => {
	it("fnv1a ist deterministisch und 8-stellig", () => {
		expect(fnv1a("abc")).toBe(fnv1a("abc"));
		expect(fnv1a("abc")).not.toBe(fnv1a("abd"));
		expect(fnv1a("")).toMatch(/^[0-9a-f]{8}$/);
	});
	it("sha256Hex entspricht dem bekannten Testvektor", async () => {
		expect(await sha256Hex(new TextEncoder().encode("abc"))).toBe(
			"ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
		);
	});
});
