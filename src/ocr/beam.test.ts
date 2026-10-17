import { describe, expect, it } from "vitest";
import { ctcBeamSearch, tokenMode } from "./beam";
import { ctcGreedy } from "./ctc";
import { markdownToCorpus } from "./corpus";
import { alphabetCodes, buildCharLm, extendHistory, lmLogProb } from "./lm";

const ALPHABET = "abcdefghijklmnopqrstuvwxyzI0123456789 .:/";
const C = Array.from(ALPHABET).length + 1;
const cls = (ch: string) => Array.from(ALPHABET).indexOf(ch) + 1;

/** Logits aus Frames: jeder Frame ist eine Liste [Zeichen, Wahrscheinlichkeit] (Rest auf Blank). */
function logits(frames: [string, number][][]): { data: Float32Array; dims: number[] } {
	const data = new Float32Array(frames.length * C).fill(Math.log(1e-4));
	frames.forEach((f, t) => {
		let rest = 1;
		for (const [ch, p] of f) {
			data[t * C + (ch === "" ? 0 : cls(ch))] = Math.log(p);
			rest -= p;
		}
		if (!f.some(([ch]) => ch === "")) data[t * C] = Math.log(Math.max(rest, 1e-4));
	});
	return { data, dims: [1, frames.length, C] };
}
/** Ein Zeichen pro Frame, dazwischen Blank-Frames. */
const spell = (frames: [string, number][][]) => frames.flatMap((f) => [f, [["", 0.99]] as [string, number][]]);

describe("Zeichen-LM", () => {
	const lm = buildCharLm(["der router leitet pakete", "der switch", "die router"], ALPHABET, { order: 4, minCount: 1 });
	const codes = alphabetCodes(ALPHABET);
	const hist = (s: string) => Array.from(s).reduce((h, ch) => extendHistory(lm, h, codes.get(ch)!), codes.get(" ")!);

	it("ist normiert: Σ P(c | h) = 1", () => {
		for (const h of ["", "de", "rou", "xyz"]) {
			let sum = 0;
			for (let k = 1; k <= codes.size; k++) sum += Math.exp(lmLogProb(lm, hist(h), k));
			expect(sum).toBeCloseTo(1, 6);
		}
	});
	it("bevorzugt gesehene Fortsetzungen", () => {
		expect(lmLogProb(lm, hist("rou"), codes.get("t")!)).toBeGreaterThan(lmLogProb(lm, hist("rou"), codes.get("x")!));
	});
});

describe("ctcBeamSearch", () => {
	it("entspricht ohne LM der Greedy-Dekodierung", () => {
		const { data, dims } = logits(spell([[["h", 0.9]], [["a", 0.8]], [["l", 0.9]], [["l", 0.9]], [["o", 0.7]]]));
		expect(ctcBeamSearch(data, dims, ALPHABET, { beta: 0 }).text).toBe("hallo");
		expect(ctcGreedy(data, dims, ALPHABET).text).toBe("hallo");
	});
	it("das LM entscheidet unsichere Zeichen", () => {
		const lm = buildCharLm(Array(20).fill("der router"), ALPHABET, { order: 5, minCount: 1 });
		// „rouker“: das t ist knapp schlechter als k
		const { data, dims } = logits(spell([[["r", 0.9]], [["o", 0.9]], [["u", 0.9]], [["k", 0.5], ["t", 0.45]], [["e", 0.9]], [["r", 0.9]]]));
		expect(ctcGreedy(data, dims, ALPHABET).text).toBe("rouker");
		expect(ctcBeamSearch(data, dims, ALPHABET, { lm, alpha: 0.5, beta: 1 }).text).toBe("router");
	});
	it("Grammatik: in einer IPv6-Adresse gewinnt die Ziffer gegen das I", () => {
		const frames: [string, number][][] = [..."fe80::"].map((ch) => [[ch, 0.95]]);
		frames.push([["I", 0.55], ["1", 0.4]]);
		const { data, dims } = logits(spell(frames));
		expect(ctcGreedy(data, dims, ALPHABET).text).toBe("fe80::I");
		expect(ctcBeamSearch(data, dims, ALPHABET, { lm: null, beta: 0 }).text).toBe("fe80::1");
		expect(ctcBeamSearch(data, dims, ALPHABET, { lm: null, beta: 0, grammar: false }).text).toBe("fe80::I");
	});
	it("tokenMode erkennt Adressen, aber keine Wörter mit Doppelpunkt", () => {
		expect(tokenMode("2001:db8::")).toBe("ipv6");
		expect(tokenMode("fe80::")).toBe("ipv6");
		expect(tokenMode("2001:db8")).toBe("ipv6");
		expect(tokenMode("192.168.1")).toBe("ipv4");
		expect(tokenMode("10.0.0.0/2")).toBe("ipv4");
		expect(tokenMode("Adresse:")).toBeNull();
		expect(tokenMode("abc:def")).toBeNull();
		expect(tokenMode("Hallo")).toBeNull();
	});
});

describe("markdownToCorpus", () => {
	it("entfernt Frontmatter, ink-Blöcke, Links und Syntax, behält Code", () => {
		const md = [
			"---",
			"tags: [netz]",
			"---",
			"# Subnetting",
			"- Die **Maske** ist [[Subnetzmaske|wichtig]], siehe [Doku](https://x.y/z).",
			"```ink",
			"file: _ink/a.ink",
			"text: |",
			"  Feh1er der OCR",
			"```",
			"```sql",
			"SELECT * FROM kunden;",
			"```",
		].join("\n");
		expect(markdownToCorpus(md)).toEqual(["Subnetting", "Die Maske ist wichtig, siehe Doku.", "SELECT * FROM kunden;"]);
	});
});
