import { requestUrl } from "obsidian";

const URL = "http://127.0.0.1:8765/suggest";
const TIMEOUT_MS = 12000;
const MAX_WORDS = 6;
const MAX_CHARS = 70;
const MAX_BEFORE = 300;
const MAX_NOTE = 600;
/** Steuerzeichen und Zeichen, die in Handschrift nichts verloren haben. */
const ALLOWED = /^[\p{L}\p{N} .,;:!?()%€/+=\-–'’]+$/u;

export interface ClaudeRequest {
	title: string;
	note: string;
	/** Bisher Geschriebenes bis zur Schreibposition */
	before: string;
}

export function buildPrompt({ title, note, before }: ClaudeRequest): string {
	const text = before.replace(/\s+/g, " ").trim().slice(-MAX_BEFORE);
	return `Notiz: ${title}\nInhalt: ${note.replace(/\s+/g, " ").trim().slice(0, MAX_NOTE)}\nText: ${text}|`;
}

/**
 * Antwort von Claude → fehlender Text. Mit `~` ergänzt sie das aktuelle Wort, sonst folgt ein neues Wort (dann
 * beginnt das Ergebnis mit einem Leerzeichen). `null`, wenn nichts Brauchbares kam.
 */
export function parseReply(reply: string): string | null {
	// Die eigentliche Antwort steht zuletzt; Haiku schreibt gelegentlich eine Vorrede davor.
	const line = (reply.trim().split("\n").filter((l) => l.trim()).at(-1) ?? "").trim().replace(/^["„“']+|["„“']+$/g, "").trim();
	if (!line || line === "-") return null;
	const body = line.startsWith("~") ? line.slice(1).trim() : line;
	// Fehlende Buchstaben sind klein; beginnt es groß, ist es ein neues Wort, auch wenn ~ davorsteht.
	const partial = line.startsWith("~") && body[0] === body[0]?.toLowerCase();
	const words = body.split(/\s+/).filter(Boolean).slice(0, MAX_WORDS);
	const text = words.join(" ");
	if (!text || text.length > MAX_CHARS || !ALLOWED.test(text)) return null;
	return partial ? text : ` ${text}`;
}

/**
 * Der zuletzt von Claude vorgeschlagene Text. Schreibt man ihn weiter, wird der Rest sofort gezeigt, ohne neue
 * Anfrage – das ist schneller und schont das Limit.
 */
export class Continuation {
	private words: string[] = [];

	set(word: string, rest: string) {
		const parts = rest.trim().split(/\s+/).filter(Boolean);
		this.words = rest.startsWith(" ") ? [word, ...parts] : [word + (parts[0] ?? ""), ...parts.slice(1)];
	}

	clear() {
		this.words = [];
	}

	/** Rest des Vorschlags, wenn `word` dazu passt (dasselbe oder das nächste vorgeschlagene Wort); sonst `null`. */
	next(word: string): string | null {
		for (let i = 0; i < Math.min(2, this.words.length); i++) {
			const candidate = this.words[i];
			if (!candidate.startsWith(word)) continue;
			this.words = this.words.slice(i);
			const after = this.words.slice(1).join(" ");
			if (candidate !== word) return candidate.slice(word.length) + (after ? ` ${after}` : "");
			return after ? ` ${after}` : null;
		}
		this.words = [];
		return null;
	}
}

export class ClaudeError extends Error {}

/** Fragt den lokalen Dienst `ink-claude` (siehe scripts/ink-claude.py). */
export async function askClaude(token: string, prompt: string): Promise<string> {
	let timer = 0;
	const timeout = new Promise<never>((_, reject) => {
		timer = window.setTimeout(() => reject(new ClaudeError("timeout")), TIMEOUT_MS);
	});
	try {
		const res = await Promise.race([
			requestUrl({ url: URL, method: "POST", contentType: "application/json", headers: { "X-Ink-Token": token }, body: JSON.stringify({ prompt }), throw: false }),
			timeout,
		]);
		if (res.status !== 200) throw new ClaudeError(`status ${res.status}`);
		return String((res.json as { text?: unknown }).text ?? "");
	} finally {
		window.clearTimeout(timer);
	}
}
