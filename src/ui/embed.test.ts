import { describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => ({}));
vi.mock("../commands", () => ({}));
vi.mock("../render/background", () => ({}));

const { findEmbed } = await import("./EmbedAnnotator");

describe("findEmbed", () => {
	it("findet Bild/PDF, überspringt eingebettete Notizen", () => {
		expect(findEmbed("![[Notiz]] und ![[bild.png|300]]")).toEqual({ index: 15, length: 17, linktext: "bild.png" });
		expect(findEmbed("![[blatt.pdf#page=2]]")?.linktext).toBe("blatt.pdf#page=2");
		expect(findEmbed("![[Notiz]]")).toBeNull();
		expect(findEmbed("[[bild.png]]")).toBeNull();
	});
	it("mit src genau diese Einbettung", () => {
		expect(findEmbed("![[a.png]] ![[b.png]]", "b.png")).toEqual({ index: 11, length: 10, linktext: "b.png" });
		expect(findEmbed("![[a.png]]", "c.png")).toBeNull();
	});
});
