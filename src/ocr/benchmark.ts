/**
 * OCR-Messung mit eigener Handschrift: eine Notiz mit Vorgabesätzen und je einer Schreibfläche.
 * Nach dem Schreiben wird erkannt und die Zeichenfehlerrate (CER) pro Zeile und gesamt berechnet.
 */

/** 30 Sätze: Alltag, Umlaute/ß, Netzwerk-/IT-Begriffe, Code. Nur Zeichen aus dem Alphabet von de-htr-web-v2. */
export const BENCHMARK_PROMPTS = [
	"Die Übung beginnt um acht Uhr.",
	"Größe, Maß und Gewicht",
	"Der Router leitet Pakete weiter.",
	"IPv6-Adresse: 2001:db8::1",
	"Subnetzmaske 255.255.255.0",
	"Das Netz 192.168.10.0/24",
	"Wie viele Hosts hat ein /27-Netz?",
	"Link-Local beginnt mit fe80::",
	"Die Loopback-Adresse ist ::1",
	"Schicht 3 ist die Vermittlungsschicht.",
	"Ein Switch arbeitet auf Schicht 2.",
	"TCP ist verbindungsorientiert.",
	"UDP ist schneller, aber unzuverlässig.",
	"Die Prüfung ist am Freitag.",
	"Für morgen: Aufgabe 4 und 5 lösen.",
	"Wörter mit ä, ö, ü und ß",
	"Straße, Fuß, weiß, heißen",
	"Quellcode: int x = 42;",
	"if (a > b) return a;",
	"Die Funktion gibt true zurück.",
	"Datenbank, Tabelle, Primärschlüssel",
	"SELECT * FROM kunden;",
	"Anwendungsentwicklung ist spannend.",
	"Berufsschule, Fachinformatiker",
	"Der Server antwortet mit 404.",
	"HTTP nutzt Port 80, HTTPS Port 443.",
	"Das Ergebnis ist 3,14 Prozent.",
	"Zuerst planen, dann programmieren.",
	"Kühlschrank, Bügeleisen, Glühbirne",
	"Ende der Messung - danke!",
];

export const REPORT_HEADING = "## Ergebnis";
/** Anfang jeder Messnotiz – solche Notizen bleiben aus dem Sprachmodell draußen. */
export const BENCHMARK_TITLE = "# OCR-Messung";

/** Levenshtein-Distanz auf Codepoints. */
export function editDistance(a: string, b: string): number {
	const x = Array.from(a);
	const y = Array.from(b);
	let prev = Array.from({ length: y.length + 1 }, (_, j) => j);
	for (let i = 1; i <= x.length; i++) {
		const cur = [i];
		for (let j = 1; j <= y.length; j++) {
			cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
		}
		prev = cur;
	}
	return prev[y.length];
}

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

/** Zeichenfehlerrate: Editierdistanz / Länge der Vorgabe (Leerraum normalisiert). */
export function cer(reference: string, hypothesis: string): number {
	const ref = norm(reference);
	return ref.length ? editDistance(ref, norm(hypothesis)) / Array.from(ref).length : 0;
}

/** Inhalt der Messnotiz (Blöcke werden mit ihren .ink-Pfaden eingesetzt). */
export function benchmarkNote(inkPaths: string[], date: string): string {
	const parts = [
		`${BENCHMARK_TITLE} ${date}`,
		"",
		"Schreibe jeden Satz **so wie du normal schreibst** in die Fläche darunter. Danach den Befehl",
		"„Ink Blocks: OCR-Messung auswerten“ ausführen – das Ergebnis erscheint unten.",
		"",
	];
	BENCHMARK_PROMPTS.forEach((prompt, i) => {
		parts.push(`**${i + 1}.** ${prompt}`, "", "```ink", `file: ${inkPaths[i]}`, "```", "");
	});
	return parts.join("\n");
}

export interface BenchmarkItem {
	n: number;
	prompt: string;
	inkPath: string;
	/** Zeile des Fence (0-basiert) */
	line: number;
}

/** Vorgaben und zugehörige Blöcke aus der Messnotiz lesen (Vorgabe = letzte `**N.** …`-Zeile vor dem Block). */
export function parseBenchmark(note: string, fences: { open: number; file?: string }[]): BenchmarkItem[] {
	const lines = note.split(/\r?\n/);
	const items: BenchmarkItem[] = [];
	for (const fence of fences) {
		if (!fence.file) continue;
		for (let i = fence.open - 1; i >= 0 && i >= fence.open - 4; i--) {
			const m = /^\*\*(\d+)\.\*\*\s+(.*)$/.exec(lines[i]);
			if (m) {
				items.push({ n: Number(m[1]), prompt: m[2].trim(), inkPath: fence.file, line: fence.open });
				break;
			}
		}
	}
	return items;
}

export interface BenchmarkRow {
	n: number;
	prompt: string;
	recognized: string;
}

const pct = (x: number) => `${(x * 100).toFixed(1).replace(".", ",")} %`;
const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");

/** Ergebnis als Markdown. Leere Flächen zählen nicht zur Gesamt-CER. */
export function benchmarkReport(rows: BenchmarkRow[], engine: string, date: string): string {
	const written = rows.filter((r) => r.recognized.trim());
	let dist = 0;
	let len = 0;
	for (const r of written) {
		dist += editDistance(norm(r.prompt), norm(r.recognized));
		len += Array.from(norm(r.prompt)).length;
	}
	const lines = [
		REPORT_HEADING,
		"",
		`Engine: \`${engine}\` · ausgewertet: ${date} · ${written.length}/${rows.length} Zeilen geschrieben`,
		"",
		`**Gesamt-CER: ${len ? pct(dist / len) : "–"}**`,
		"",
		"| Nr. | Vorgabe | Erkannt | CER |",
		"|---:|---|---|---:|",
		...rows.map((r) =>
			`| ${r.n} | ${cell(r.prompt)} | ${cell(r.recognized) || "–"} | ${r.recognized.trim() ? pct(cer(r.prompt, r.recognized)) : "–"} |`,
		),
		"",
	];
	return lines.join("\n");
}

/** Bericht anhängen bzw. vorhandenen Ergebnis-Abschnitt (bis zum Ende) ersetzen. */
export function upsertReport(note: string, report: string): string {
	const idx = note.indexOf(`\n${REPORT_HEADING}\n`);
	const head = idx >= 0 ? note.slice(0, idx) : note.replace(/\s*$/, "");
	return `${head}\n\n${report}`;
}
