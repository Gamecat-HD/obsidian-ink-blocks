import { describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => ({ requestUrl: vi.fn() }));

const { buildPrompt, Continuation, parseReply } = await import("./claude");

describe("Continuation", () => {
	function fresh() {
		const c = new Continuation();
		c.set("Kost", "enstelle verteilen dann");
		return c;
	}

	it("zeigt den Rest, wenn das Wort weitergeschrieben wird", () => {
		expect(fresh().next("Kosten")).toBe("stelle verteilen dann");
	});

	it("springt nach dem fertigen Wort zum nächsten", () => {
		const c = fresh();
		expect(c.next("Kostenstelle")).toBe(" verteilen dann");
		expect(c.next("ver")).toBe("teilen dann");
	});

	it("erkennt, wenn man schon beim nächsten Wort ist", () => {
		expect(fresh().next("vert")).toBe("eilen dann");
	});

	it("verwirft den Vorschlag bei Abweichung", () => {
		const c = fresh();
		expect(c.next("Haus")).toBeNull();
		expect(c.next("Kosten")).toBeNull();
	});

	it("hat nach dem letzten Wort nichts mehr", () => {
		const c = new Continuation();
		c.set("Haus", "tür");
		expect(c.next("Haustür")).toBeNull();
	});

	it("versteht neue Wörter", () => {
		const c = new Continuation();
		c.set("ich", " esse gerne");
		expect(c.next("ich")).toBe(" esse gerne");
		expect(c.next("es")).toBe("se gerne");
	});
});

describe("parseReply", () => {
	it("ergänzt das aktuelle Wort bei ~", () => {
		expect(parseReply("~enstelle verteilen")).toBe("enstelle verteilen");
	});

	it("setzt neue Wörter mit Leerzeichen ab", () => {
		expect(parseReply("wird verteilt")).toBe(" wird verteilt");
	});

	it("nimmt - und Leeres als keinen Vorschlag", () => {
		expect(parseReply("-")).toBeNull();
		expect(parseReply("   ")).toBeNull();
	});

	it("entfernt Anführungszeichen", () => {
		expect(parseReply('„wird verteilt"')).toBe(" wird verteilt");
	});

	it("überspringt eine Vorrede", () => {
		expect(parseReply('Notiz-Fortsetzung: "kosten" — daher mit ~ beginnen.\n\n~kosten und Istkosten')).toBe("kosten und Istkosten");
	});

	it("macht aus ~ mit Großbuchstaben ein neues Wort", () => {
		expect(parseReply("~Netzwerke miteinander")).toBe(" Netzwerke miteinander");
	});

	it("kürzt auf höchstens sechs Wörter", () => {
		expect(parseReply("a b c d e f g h")).toBe(" a b c d e f");
	});

	it("verwirft unbrauchbare Zeichen und zu lange Antworten", () => {
		expect(parseReply("<script>alert(1)</script>")).toBeNull();
		expect(parseReply("x".repeat(100))).toBeNull();
	});

	it("erlaubt Zahlen und Satzzeichen", () => {
		expect(parseReply("von 12,5 %.")).toBe(" von 12,5 %.");
	});
});

describe("buildPrompt", () => {
	it("markiert die Schreibposition", () => {
		const p = buildPrompt({ title: "BAB", note: "Inhalt  hier", before: "Die Kosten" });
		expect(p).toBe("Notiz: BAB\nInhalt: Inhalt hier\nText: Die Kosten|");
	});

	it("begrenzt den Umfang und behält das Ende des Textes", () => {
		const p = buildPrompt({ title: "t", note: "n".repeat(5000), before: `${"a".repeat(5000)}Ende` });
		expect(p.length).toBeLessThan(1000);
		expect(p.endsWith("Ende|")).toBe(true);
	});
});
