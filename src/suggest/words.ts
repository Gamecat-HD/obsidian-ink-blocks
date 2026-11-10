/** Wörter aus Klartext; Bindestriche nur im Wort. */
const WORD = /\p{L}[\p{L}-]*\p{L}/gu;
const ONLY_LETTERS = /^\p{L}[\p{L}-]*$/u;

/** Kürzere Anfänge ergänzen wir nicht: zu viele Treffer, der Vorschlag wäre geraten. */
export const MIN_PREFIX = 3;
/** So oft muss ein Wort in den Notizen vorkommen, damit es vorgeschlagen wird. */
const MIN_COUNT = 3;
/** Mindestanteil des besten Wortes an allen Wörtern mit diesem Anfang. */
const MIN_SHARE = 0.3;
/** Mindestens so viele Zeichen muss ein Vorschlag ergänzen, sonst lohnt das Antippen nicht. */
const MIN_REST = 2;
/** Mit einem passenden Vorgänger reicht ein kürzerer Anfang. */
const MIN_PREFIX_IN_CONTEXT = 2;
/** Mindestanteil des besten Wortes unter den Wörtern, die auf diesen Vorgänger folgen. */
const MIN_CONTEXT_SHARE = 0.4;
/** Ein Vorkommen in der aktuellen Notiz zählt so viel wie so viele Vorkommen im restlichen Vault. */
const NOTE_WEIGHT = 5;
/** So oft muss ein Wort auf das letzte gefolgt sein, um es ungefragt vorzuschlagen. */
const MIN_FOLLOW_COUNT = 2;
const MAX_PHRASE = 3;

export interface Completion {
	word: string;
	/** Der noch fehlende Teil. */
	rest: string;
	/** Das Wort davor hat den Ausschlag gegeben. */
	byContext: boolean;
}

export interface WordContext {
	/** Das Wort davor */
	previous?: string;
	/** Wörter der aktuellen Notiz und Schreibfläche mit Anzahl */
	note?: Map<string, number>;
}

interface Candidate {
	rest: string;
	weight: number;
	after: number;
}


const chars = (s: string) => Array.from(s).length;

/** Häufigkeiten der Wörter im Vault; ergänzt ein angefangenes Wort zum wahrscheinlichsten. */
export class WordIndex {
	private readonly counts = new Map<string, number>();
	/** Wie oft ein Wort direkt auf ein anderes folgt (Vorgänger in Kleinschreibung → Wort → Anzahl) */
	private readonly followers = new Map<string, Map<string, number>>();
	private sorted: string[] | null = null;

	add(line: string) {
		// Auch kurze Wörter zählen: Sonst wüsste der Index nicht, dass „die“ schon fertig ist.
		let previous: string | null = null;
		for (const m of line.matchAll(WORD)) {
			this.counts.set(m[0], (this.counts.get(m[0]) ?? 0) + 1);
			if (previous) {
				let next = this.followers.get(previous);
				if (!next) this.followers.set(previous, (next = new Map()));
				next.set(m[0], (next.get(m[0]) ?? 0) + 1);
			}
			previous = m[0].toLowerCase();
		}
		this.sorted = null;
	}

	get size(): number {
		return this.counts.size;
	}

	private list(): string[] {
		return (this.sorted ??= [...this.counts.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
	}

	/** Alle Wörter, die mit `prefix` beginnen (Vergleich nach Code-Einheiten, passend zur Sortierung). */
	private withPrefix(prefix: string): string[] {
		const list = this.list();
		let lo = 0;
		let hi = list.length;
		while (lo < hi) {
			const mid = (lo + hi) >> 1;
			if (list[mid] < prefix) lo = mid + 1;
			else hi = mid;
		}
		const out: string[] = [];
		for (let i = lo; i < list.length && list[i].startsWith(prefix); i++) out.push(list[i]);
		return out;
	}

	/**
	 * Ergänzung für den Wortanfang, oder `null`, wenn sie nicht sicher genug ist. Ein großgeschriebener Anfang
	 * findet auch kleingeschriebene Wörter (Satzanfang), die Ergänzung behält dann die Schreibweise des Anfangs.
	 * Passt ein Wort zum Vorgänger, zählt das zuerst; sonst entscheidet die Häufigkeit, Wörter der aktuellen
	 * Notiz zählen dabei mehr.
	 */
	complete(prefix: string, context: WordContext = {}): Completion | null {
		const length = chars(prefix);
		const previous = context.previous?.toLowerCase();
		if (length < (previous ? MIN_PREFIX_IN_CONTEXT : MIN_PREFIX) || !ONLY_LETTERS.test(prefix)) return null;
		const lower = prefix[0].toLowerCase() + prefix.slice(1);
		const variants = lower === prefix ? [prefix] : [prefix, lower];
		const weight = (word: string, count: number) => count + NOTE_WEIGHT * (context.note?.get(word) ?? 0);
		const after = (word: string) => (previous ? (this.followers.get(previous)?.get(word) ?? 0) : 0);
		let exact = 0;
		let exactAfter = 0;
		const candidates: Candidate[] = [];
		for (const variant of variants) {
			exact += weight(variant, this.counts.get(variant) ?? 0);
			exactAfter += after(variant);
			for (const word of this.withPrefix(variant)) {
				if (word !== variant) candidates.push({ rest: word.slice(variant.length), weight: weight(word, this.counts.get(word)!), after: after(word) });
			}
		}
		const shorter = (a: Candidate, b: Candidate) => a.rest.length - b.rest.length;
		const followers = candidates.filter((c) => c.after > 0).sort((a, b) => b.after - a.after || b.weight - a.weight || shorter(a, b));
		if (followers.length) {
			const best = followers[0];
			// Nach diesem Vorgänger steht meistens genau das Geschriebene: Es ist vermutlich schon fertig.
			if (exactAfter >= best.after) return null;
			const total = followers.reduce((n, c) => n + c.after, 0);
			if (best.after / total >= MIN_CONTEXT_SHARE && chars(best.rest) >= MIN_REST && (best.after >= 2 || best.weight >= MIN_COUNT)) {
				return { word: prefix + best.rest, rest: best.rest, byContext: true };
			}
		}
		if (length < MIN_PREFIX) return null;
		const total = candidates.reduce((n, c) => n + c.weight, 0);
		const best = [...candidates].sort((a, b) => b.weight - a.weight || shorter(a, b))[0];
		if (!best || best.weight < MIN_COUNT || chars(best.rest) < MIN_REST) return null;
		// Das Geschriebene ist selbst ein gängiges Wort: vermutlich ist es schon fertig.
		if (exact >= best.weight) return null;
		if (best.weight / total < MIN_SHARE) return null;
		return { word: prefix + best.rest, rest: best.rest, byContext: false };
	}

	/** Das wahrscheinlichste nächste Wort, wenn es nach `word` klar vorn liegt. */
	private follower(word: string): string | null {
		const next = this.followers.get(word.toLowerCase());
		if (!next) return null;
		let total = 0;
		let best: [string, number] | null = null;
		for (const entry of next) {
			total += entry[1];
			if (!best || entry[1] > best[1]) best = entry;
		}
		return best && best[1] >= MIN_FOLLOW_COUNT && best[1] / total >= MIN_CONTEXT_SHARE ? best[0] : null;
	}

	/** Wie es nach `word` meist weitergeht: bis zu drei Wörter, die in den Notizen so aufeinander folgen; `null` = keine klare Fortsetzung. */
	phrase(word: string): string | null {
		const out: string[] = [];
		for (let current = word; out.length < MAX_PHRASE; ) {
			const next = this.follower(current);
			if (!next || out.includes(next)) break;
			out.push(next);
			current = next;
		}
		return out.length ? out.join(" ") : null;
	}
}

/** Wie oft jedes Wort in diesen Zeilen vorkommt (aktuelle Notiz, diese Schreibfläche). */
export function countWords(lines: Iterable<string>, into = new Map<string, number>()): Map<string, number> {
	for (const line of lines) for (const m of line.matchAll(WORD)) into.set(m[0], (into.get(m[0]) ?? 0) + 1);
	return into;
}

/** Index aus vielen Zeilen, ohne die Oberfläche zu blockieren. */
export async function buildWordIndex(lines: string[], chunk = 2000): Promise<WordIndex> {
	const index = new WordIndex();
	for (let i = 0; i < lines.length; i++) {
		index.add(lines[i]);
		if (i % chunk === chunk - 1) await new Promise((resolve) => window.setTimeout(resolve, 0));
	}
	return index;
}
