/**
 * Schreibtraining: Proben aus Strichen und Soll-Text. Sie entstehen beim Diktat (Soll-Text vorgegeben) und beim
 * Überprüfen erkannter Wörter (vom Nutzer bestätigt oder korrigiert). Gespeichert als JSONL, eine Probe je Zeile,
 * Punkte wie in `.ink` quantisiert und delta-codiert.
 */
import { decodePoints, encodePoints } from "../model/ink-format";
import { fnv1a } from "../util/hash";

/** „letters“: einzeln geschriebene Buchstaben für die Wortvorschläge – zählen nicht für die Texterkennung. */
export type SampleSource = "dictation" | "review" | "letters";

export interface TrainingSample {
	id: string;
	/** Soll-Text; `null` = beim Überprüfen als „kein Text“ verworfen (Zeichnung, Gekritzel) */
	text: string | null;
	/** Was die Erkennung gelesen hat */
	got: string;
	source: SampleSource;
	/** Engine-Version beim Erkennen */
	engine: string;
	/** Punkte je Strich [x, y, p, …] in Doc-Einheiten */
	strokes: number[][];
	/** Referenzhöhe der Schrift, mit der gerastert wurde */
	refHeight: number;
	/** ISO-Zeitpunkt */
	at: string;
	device: "desktop" | "mobile";
	/** Überprüfen: Kennung des Wortes (Hash seiner Strich-IDs) – dasselbe Wort wird nicht noch einmal gefragt. */
	key?: string;
	inkPath?: string;
}

interface StoredSample extends Omit<TrainingSample, "strokes"> {
	/** Striche wie in `.ink` codiert */
	p: number[][];
}

/** Jede fünfte Probe (fest nach ID) bleibt draußen und prüft, ob eine Abstimmung wirklich hilft. */
export function isHoldout(id: string): boolean {
	return parseInt(fnv1a(id).slice(-2), 16) % 5 === 0;
}

export function encodeSample(sample: TrainingSample): string {
	const { strokes, ...rest } = sample;
	const stored: StoredSample = { ...rest, p: strokes.map((s) => encodePoints(s)) };
	return JSON.stringify(stored);
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** JSONL lesen; kaputte Zeilen werden übersprungen. */
export function parseSamples(text: string): TrainingSample[] {
	const out: TrainingSample[] = [];
	for (const line of text.split("\n")) {
		if (!line.trim()) continue;
		let raw: StoredSample;
		try {
			raw = JSON.parse(line);
		} catch {
			continue;
		}
		if (typeof raw?.id !== "string" || (raw.text !== null && typeof raw.text !== "string") || !Array.isArray(raw.p)) continue;
		if (!raw.p.every((s) => Array.isArray(s) && s.length % 3 === 0 && s.every(isNum))) continue;
		const { p, ...rest } = raw;
		out.push({
			...rest,
			got: typeof rest.got === "string" ? rest.got : "",
			source: rest.source === "review" || rest.source === "letters" ? rest.source : "dictation",
			refHeight: isNum(rest.refHeight) ? rest.refHeight : 10,
			strokes: p.map((s) => decodePoints(s)),
		});
	}
	return out;
}

/** Spätere Proben mit gleichem `key` ersetzen frühere (Wort erneut überprüft). Reihenfolge bleibt. */
export function dedupeSamples(samples: TrainingSample[]): TrainingSample[] {
	const last = new Map<string, number>();
	samples.forEach((s, i) => s.key && last.set(s.key, i));
	return samples.filter((s, i) => !s.key || last.get(s.key) === i);
}

/** Proben mit Text (verworfene „kein Text“-Proben und Buchstabenreihen zählen nicht). */
export function labeled(samples: TrainingSample[]): (TrainingSample & { text: string })[] {
	return samples.filter((s): s is TrainingSample & { text: string } => s.source !== "letters" && typeof s.text === "string" && s.text.trim() !== "" && s.strokes.length > 0);
}

/**
 * Fehler je Soll-Zeichen (Levenshtein-Rückverfolgung): Wie oft kam ein Zeichen vor, wie oft wurde es falsch
 * oder gar nicht gelesen? Leerzeichen zählen nicht.
 */
export function charErrors(reference: string, hypothesis: string, into = new Map<string, { errors: number; total: number }>()) {
	const x = Array.from(reference);
	const y = Array.from(hypothesis);
	const d = Array.from({ length: x.length + 1 }, (_, i) => Array.from({ length: y.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
	for (let i = 1; i <= x.length; i++) {
		for (let j = 1; j <= y.length; j++) {
			d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
		}
	}
	const bump = (ch: string, wrong: boolean) => {
		if (ch === " ") return;
		const e = into.get(ch) ?? { errors: 0, total: 0 };
		e.total++;
		if (wrong) e.errors++;
		into.set(ch, e);
	};
	let i = x.length;
	let j = y.length;
	while (i > 0) {
		if (j > 0 && d[i][j] === d[i - 1][j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1)) {
			bump(x[i - 1], x[i - 1] !== y[j - 1]);
			i--;
			j--;
		} else if (d[i][j] === d[i - 1][j] + 1) {
			bump(x[i - 1], true);
			i--;
		} else {
			j--;
		}
	}
	return into;
}

/** Fehlerquote je Zeichen über alle Proben (nur Zeichen, die mindestens `minTotal`-mal vorkamen). */
export function weakChars(samples: TrainingSample[], minTotal = 3): Map<string, number> {
	const stats = new Map<string, { errors: number; total: number }>();
	for (const s of labeled(samples)) charErrors(s.text, s.got, stats);
	const out = new Map<string, number>();
	for (const [ch, { errors, total }] of stats) if (total >= minTotal && errors > 0) out.set(ch, errors / total);
	return out;
}

/** Zusammenfassung für Einstellungen und Dialoge. */
export function sampleStats(samples: TrainingSample[]) {
	const items = labeled(samples);
	let errors = 0;
	let chars = 0;
	for (const s of items) {
		const ref = s.text.replace(/\s+/g, " ").trim();
		const d = charErrors(ref, s.got.replace(/\s+/g, " ").trim());
		for (const v of d.values()) {
			errors += v.errors;
			chars += v.total;
		}
	}
	return {
		count: items.length,
		dictation: items.filter((s) => s.source === "dictation").length,
		review: items.filter((s) => s.source === "review").length,
		/** Fehlerquote der Erkennung zum Zeitpunkt der Aufnahme (ohne Leerzeichen) */
		cer: chars ? errors / chars : 0,
	};
}
