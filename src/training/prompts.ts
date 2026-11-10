/**
 * Vorgaben fürs Diktat: 1–3 Wörter aus dem eigenen Vault, Fachbegriffe, Wörter mit Umlauten/ß sowie Zahlen und
 * Adressen. Zeichen, die bei dir oft falsch gelesen werden, kommen häufiger dran.
 */

/** Grundstock, falls der Vault (noch) wenig hergibt: Umlaute, ß, Großbuchstaben, typische Schulwörter. */
export const BASE_WORDS = [
	"Größe", "Übung", "Straße", "Prüfung", "Schlüssel", "äußern", "Gemüse", "Brücke", "Mädchen", "Öffnung",
	"fließen", "Füße", "Tür", "Bär", "König", "Häuser", "müssen", "Fußball", "Übersicht", "Lösung",
	"Netzwerk", "Router", "Adresse", "Protokoll", "Schicht", "Paket", "Server", "Client", "Datenbank", "Tabelle",
	"Quiz", "Yacht", "Xylophon", "jung", "Qualität", "Zwerg", "Vogel", "Wasser", "Kaffee", "Himmel",
];

const ALPHABET = "abcdefghijklmnopqrstuvwxyzäöüßABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÜ";

/** Übungszeilen für einzelne Buchstaben: je zwei Buchstaben doppelt, dazu ein „n“ als Maß für die Größe. */
export function letterPrompts(needsPractice: (ch: string) => boolean): string[] {
	const letters = Array.from(ALPHABET).filter(needsPractice);
	const out: string[] = [];
	for (let i = 0; i < letters.length; i += 2) out.push([letters[i], letters[i], ...(letters[i + 1] ? [letters[i + 1], letters[i + 1]] : []), "n"].join(" "));
	return out;
}

const WORD = /^[A-Za-zÄÖÜäöüß][A-Za-zÄÖÜäöüß-]{2,15}$/;

/** Wörter aus Vault-Zeilen mit Häufigkeit (nur Buchstaben, 3–16 Zeichen, Bindestrich erlaubt). */
export function vaultWords(lines: Iterable<string>): Map<string, number> {
	const freq = new Map<string, number>();
	for (const line of lines) {
		for (const raw of line.split(/\s+/)) {
			const w = raw.replace(/^[^A-Za-zÄÖÜäöüß]+|[^A-Za-zÄÖÜäöüß]+$/g, "");
			if (WORD.test(w) && !w.endsWith("-")) freq.set(w, (freq.get(w) ?? 0) + 1);
		}
	}
	return freq;
}

export interface PromptSource {
	/** Vault-Wörter mit Häufigkeit */
	words: Map<string, number>;
	hotwords: string[];
	/** Fehlerquote je Zeichen (0–1) aus den bisherigen Proben */
	weak: Map<string, number>;
	random?: () => number;
}

type Kind = "vault" | "hotword" | "base" | "number";

/** Gewicht eines Wortes: häufige Wörter öfter (gedämpft), schwache Zeichen deutlich öfter. */
function weight(word: string, freq: number, weak: Map<string, number>): number {
	let boost = 1;
	for (const ch of new Set(Array.from(word))) boost += 4 * (weak.get(ch) ?? 0);
	return Math.sqrt(freq) * boost;
}

function pickWeighted<T>(items: T[], weights: number[], random: () => number): T | undefined {
	const total = weights.reduce((a, b) => a + b, 0);
	if (!items.length || total <= 0) return items[Math.floor(random() * items.length)];
	let r = random() * total;
	for (let i = 0; i < items.length; i++) {
		r -= weights[i];
		if (r <= 0) return items[i];
	}
	return items[items.length - 1];
}

const int = (random: () => number, lo: number, hi: number) => lo + Math.floor(random() * (hi - lo + 1));

/** Zahlen und Adressen, wie sie in IT-Notizen vorkommen. */
export function numberPrompt(random: () => number = Math.random): string {
	const masks = ["255.255.255.0", "255.255.0.0", "255.255.255.128", "255.255.255.192", "255.255.252.0"];
	const hex = () => int(random, 0, 0xffff).toString(16);
	const options = [
		() => `${int(random, 1, 223)}.${int(random, 0, 255)}.${int(random, 0, 255)}.${int(random, 1, 254)}`,
		() => `${int(random, 10, 192)}.${int(random, 0, 255)}.${int(random, 0, 255)}.0/${int(random, 8, 30)}`,
		() => `Maske ${masks[int(random, 0, masks.length - 1)]}`,
		() => `2001:db8::${hex()}`,
		() => `fe80::${hex()}:${hex()}`,
		() => `${int(random, 2, 99)},${int(random, 0, 9)}${int(random, 0, 9)} €`,
		() => `${int(random, 1, 31)}.${int(random, 1, 12)}.20${int(random, 20, 30)}`,
		() => `Port ${[22, 53, 80, 443, 3306, 8080][int(random, 0, 5)]}`,
	];
	return options[int(random, 0, options.length - 1)]();
}

/**
 * Nächste Vorgabe. `recent` enthält die letzten Vorgaben (keine Wiederholung); gemischt wird etwa
 * 55 % Vault, 15 % Fachbegriffe, 15 % Grundstock (Umlaute & Co.), 15 % Zahlen/Adressen.
 */
export function nextPrompt(source: PromptSource, recent: ReadonlySet<string> = new Set()): string {
	const random = source.random ?? Math.random;
	const vault = [...source.words.entries()].filter(([w]) => !recent.has(w));
	const hot = source.hotwords.filter((w) => w.trim() && !recent.has(w));
	const base = BASE_WORDS.filter((w) => !recent.has(w));
	const r = random();
	let kind: Kind = r < 0.55 ? "vault" : r < 0.7 ? "hotword" : r < 0.85 ? "base" : "number";
	if (kind === "vault" && vault.length < 20) kind = "base";
	if (kind === "hotword" && !hot.length) kind = vault.length >= 20 ? "vault" : "base";
	if (kind === "number") return numberPrompt(random);
	if (kind === "hotword") return hot[Math.floor(random() * hot.length)].trim();

	const pool: [string, number][] = kind === "vault" ? vault : base.map((w) => [w, 4]);
	const weights = pool.map(([w, f]) => weight(w, f, source.weak));
	// Ein bis drei Wörter; lange Wörter eher allein.
	const count = int(random, 1, 3);
	const words: string[] = [];
	let length = 0;
	for (let i = 0; i < count && length < 22; i++) {
		const w = pickWeighted(pool, weights, random)?.[0];
		if (!w || words.includes(w)) continue;
		words.push(w);
		length += w.length + 1;
	}
	return words.join(" ") || BASE_WORDS[0];
}
