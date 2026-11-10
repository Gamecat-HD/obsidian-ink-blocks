import { Notice } from "obsidian";
import type { InkEditor } from "../block/InkEditor";
import type InkBlocksPlugin from "../main";
import type { Stroke } from "../model/ink-format";
import type { InkEntry } from "../store/InkStore";
import { markdownToCorpus } from "../ocr/corpus";
import { strokeBounds } from "../model/ops";
import { boxOf, segmentLines } from "../ocr/segment";
import { fnv1a } from "../util/hash";
import { shortId } from "../util/ids";
import { askClaude, buildPrompt, Continuation, parseReply } from "./claude";
import { buildGlyphLibrary, GlyphLibrary } from "./glyphs";
import { ghostHit, layoutGhost, lineLeft, writingFront, type Ghost } from "./layout";
import { buildWordIndex, countWords, type WordIndex } from "./words";

/** Frühestens so lange nach dem Absetzen erscheint ein Vorschlag – sonst blitzt er zwischen zwei Strichen auf. */
const SETTLE_MS = 120;
/** So lange bleibt ein alter Vorschlag beim Weiterschreiben höchstens stehen. */
const HOLD_MS = 1500;
/**
 * So sicher muss die Erkennung beim unsichersten Zeichen des Wortes sein. Bewusst niedrig: Bei langen Wörtern liegt
 * das schwächste Zeichen oft unter 0,6, und ein falsch gelesener Anfang findet ohnehin kein Wort im Vault.
 */
const MIN_CONFIDENCE = 0.25;
/** Vorschläge, die über den rechten Rand ragen würden, entfallen. */
const RIGHT_MARGIN = 8;
/** Zeilenabstand in x-Höhen, wenn die Fläche keine Linien hat bzw. als Mindestabstand */
const LINE_HEIGHTS = 2.6;
const MEMO_SIZE = 300;
/** Claude darf auch unsichere Wörter sehen: Aus dem Zusammenhang kann es sie oft trotzdem richtig fortsetzen. */
const CLAUDE_MIN_CONFIDENCE = 0.1;
/** So lange nach dem Absetzen wird frühestens gefragt. */
const CLAUDE_DELAY_MS = 250;
const CLAUDE_MIN_GAP_MS = 1000;
const CLAUDE_RETRY_MS = 30000;
const CLAUDE_CACHE = 50;
const STATS_FILE = "suggest-stats.json";
const STATS_SAVE_MS = 1500;
const TRACE_KEEP = 60;
/** So lange wartet die Texterkennung höchstens auf einen sichtbaren Vorschlag. */
const MAX_OCR_WAIT_MS = 60000;
const STATS_KEEP = 200;

const wordKey = (strokes: Stroke[]) => fnv1a(strokes.map((s) => s.id).sort().join(","));

interface Active {
	editor: InkEditor;
	ghost: Ghost;
	strokes: Stroke[];
	/** Striche im Dokument, als der Vorschlag erschien */
	docStrokes: number;
	/** Text und Striche der letzten Zeile: Von dort geht es nach dem Annehmen weiter. */
	text: string;
	lastStrokes: Stroke[];
	/** Letztes Wort, wenn man den Vorschlag annimmt */
	lastWord: string;
}

interface ClaudeAsk {
	live: () => boolean;
	editor: InkEditor;
	last: Stroke;
	word: string;
	/** Wovon sich die Größe ableitet (das Geschriebene oder der zuletzt angenommene Text) */
	prefix: string;
	wordStrokes: Stroke[];
	library: GlyphLibrary;
	/** Striche, aus denen die aktuelle Zeile gelesen wird */
	line: Stroke[];
	at: number;
}

interface Job {
	editor: InkEditor;
	stroke: Stroke;
	token: number;
	/** Zeitpunkt des Absetzens */
	at: number;
}

/**
 * Wortvorschläge beim Schreiben: Direkt nach dem Absetzen wird das aktuelle Wort erkannt und aus den eigenen
 * Notizen ergänzt. Der Vorschlag ist nur eine Vorschau: Er gehört nicht zum Dokument, wird nicht synchronisiert
 * und hält beim Schreiben nichts auf, bis er angetippt wird.
 */
export class SuggestService {
	/** Erhöht bei jedem neuen Anlass – eine ältere, noch laufende Erkennung verfällt damit. */
	private token = 0;
	private active: Active | null = null;
	private running = false;
	private queued: Job | null = null;
	private index: { gen: number; words: WordIndex } | null = null;
	private loading: Promise<WordIndex> | null = null;
	private glyphs: { count: number; library: GlyphLibrary } | null = null;
	private note: { path: string; mtime: number; words: Map<string, number> } | null = null;
	/** Bereits gelesene Wörter (Hash ihrer Striche → Text; leer = zu unsicher) */
	private readonly memo = new Map<string, string>();
	private readonly continuation = new Continuation();
	/** Noch sichtbarer, aber nicht mehr gültiger Vorschlag */
	private held: InkEditor | null = null;
	private shownAt = -Infinity;
	/** Eben angenommener Vorschlag, bis die Striche im Dokument sind */
	private taken: { editor: InkEditor; strokes: Stroke[]; text: string; lastWord: string } | null = null;
	private heldTimer = 0;
	private claudeBusy = false;
	private claudeNext: ClaudeAsk | null = null;
	private claudeLast = -Infinity;
	/** Bis dahin nicht fragen: Der Dienst war nicht erreichbar. */
	private claudeDownUntil = 0;
	private readonly claudeCache = new Map<string, string>();
	private readonly stats = { ms: [] as number[], shownMs: [] as number[], claudeMs: [] as number[], conf: [] as number[], trace: [] as string[], shown: 0, byContext: 0, claudeAsked: 0, claudeShown: 0, claudeReused: 0, chained: 0, claudeFailed: 0, claudeError: "", accepted: 0, tooUnsure: 0, noWord: 0 };
	private statsTimer = 0;

	constructor(private readonly plugin: InkBlocksPlugin) {}

	dispose() {
		this.dismiss();
		window.clearTimeout(this.statsTimer);
	}

	/** Vorschläge ein- bzw. ausschalten (Knopf in der Schreibleiste, Befehl). */
	toggle() {
		const { settings } = this.plugin;
		settings.suggestEnabled = !settings.suggestEnabled;
		this.settingChanged();
		new Notice(settings.suggestEnabled ? "Wortvorschläge an" : "Wortvorschläge aus", 1200);
	}

	settingChanged() {
		this.dismiss();
		this.plugin.toolsChanged();
	}

	/**
	 * Ein Strich ist fertig: sofort erkennen, damit der Vorschlag ohne Wartezeit bereitsteht. Ein laufender
	 * Durchlauf lässt sich im Worker nicht abbrechen, also läuft höchstens einer und nur der neueste wartet.
	 */
	strokeAdded(editor: InkEditor, stroke: Stroke) {
		this.hold();
		const { settings } = this.plugin;
		if (!settings.suggestEnabled || !settings.ocrEnabled || settings.tools.tool !== "pen") return this.dismiss();
		const job: Job = { editor, stroke, token: this.token, at: performance.now() };
		if (this.running) this.queued = job;
		else void this.pump(job);
	}

	private async pump(job: Job) {
		this.running = true;
		try {
			await this.suggest(job);
		} catch (e) {
			console.warn("[ink-blocks] Vorschlag", e);
		}
		this.running = false;
		const next = this.queued;
		this.queued = null;
		if (next && next.token === this.token) void this.pump(next);
		// Kein neuer Vorschlag gefunden: Der alte stimmt nicht mehr.
		else if (job.token === this.token) this.clearHeld();
	}

	/** Weitergeschrieben: Suche abbrechen und den Vorschlag nicht mehr annehmen, ihn aber kurz stehen lassen. */
	hold() {
		this.token++;
		if (!this.active) return;
		this.held = this.active.editor;
		this.active = null;
		window.clearTimeout(this.heldTimer);
		this.heldTimer = window.setTimeout(() => this.clearHeld(), HOLD_MS);
	}

	private clearHeld() {
		window.clearTimeout(this.heldTimer);
		this.held?.surface.setSuggestion(null);
		this.held = null;
	}

	/** Ist für diese Datei gerade ein Vorschlag zu sehen? Die Texterkennung wartet dann, aber nicht ewig. */
	isShowing(entry: InkEntry): boolean {
		return this.active?.editor.entry === entry && performance.now() - this.shownAt < MAX_OCR_WAIT_MS;
	}

	/** Neu geladen (Sync): Nur verwerfen, wenn wirklich neue Striche da sind. */
	documentChanged(editor: InkEditor) {
		if (this.active?.editor === editor && this.active.docStrokes !== editor.entry.doc.strokes.length) this.dismiss();
	}

	/** Vorschlag verwerfen und eine laufende Suche abbrechen. */
	dismiss() {
		this.token++;
		if (this.active) this.trace("weg");
		this.active?.editor.surface.setSuggestion(null);
		this.active = null;
		this.clearHeld();
	}

	/** Der Vorschlag gehört zu `editor`: nur dann verwerfen (z. B. wenn die Ansicht geschlossen wird). */
	forget(editor: InkEditor) {
		if (this.active?.editor === editor || this.held === editor) this.dismiss();
	}

	hit(editor: InkEditor, x: number, y: number): boolean {
		return this.active?.editor === editor && ghostHit(this.active.ghost, x, y);
	}

	/** Vorschlag annehmen: liefert die Striche, die ins Dokument sollen. */
	take(editor: InkEditor): Stroke[] | null {
		if (this.active?.editor !== editor) return null;
		const { strokes, lastStrokes, text, lastWord } = this.active;
		this.dismiss();
		this.taken = { editor, strokes: lastStrokes, text, lastWord };
		this.stats.accepted++;
		this.saveStats();
		return strokes;
	}

	/** Vorschlag setzen; was rechts nicht mehr passt, rutscht in die nächste Zeile, sofern sie frei ist. */
	private fit(editor: InkEditor, word: string, rest: string, strokes: Stroke[], library: GlyphLibrary): { ghost: Ghost; rest: string } | null {
		const { doc } = editor.entry;
		const gap = editor.lineGap;
		const ghost = layoutGhost(word, rest, strokes, library, {
			left: lineLeft(doc.strokes, strokes[strokes.length - 1]) ?? boxOf(strokes).minX,
			right: doc.w - RIGHT_MARGIN,
			bottom: doc.h - RIGHT_MARGIN,
			// Auf Linien bleiben; ist die Schrift höher als eine Linie, entsprechend mehr Abstand.
			step: (unit) => (gap ? Math.ceil((unit * LINE_HEIGHTS) / gap) * gap : unit * LINE_HEIGHTS),
			free: (box) => !doc.strokes.some((s) => {
				const b = strokeBounds(s);
				return b.maxX > box.minX && b.minX < box.maxX && b.maxY > box.minY && b.minY < box.maxY;
			}),
		});
		return ghost ? { ghost, rest: ghost.text } : null;
	}

	/**
	 * Vorschlag angenommen: gleich weitermachen, damit ein Satz nur durch Antippen entstehen kann. Zuerst der Rest
	 * von Claude, dann eine klare Wortfolge aus den Notizen, sonst sofort eine neue Frage an Claude.
	 */
	async continueAfterAccept(editor: InkEditor) {
		const taken = this.taken;
		this.taken = null;
		const { settings } = this.plugin;
		if (!taken || taken.editor !== editor || !settings.suggestEnabled) return;
		this.token++;
		const token = this.token;
		const live = () => token === this.token && this.plugin.editors.has(editor) && !editor.busy;
		const at = performance.now();
		const last = taken.strokes[taken.strokes.length - 1];
		try {
			const [words, library] = await Promise.all([this.wordIndex(), this.glyphLibrary()]);
			if (!live()) return;
			const doc = editor.entry.doc;
			const known = settings.claudeEnabled ? this.continuation.next(taken.lastWord) : null;
			const phrase = words.phrase(taken.lastWord);
			const next = known ?? (phrase ? ` ${phrase}` : null);
			const fitted = next ? this.fit(editor, taken.text, next, taken.strokes, library) : null;
			if (fitted) {
				this.show(editor, fitted.ghost, last, taken.text, fitted.rest);
				this.stats.chained++;
				return;
			}
			const line = writingFront(doc.strokes, last)?.line ?? taken.strokes;
			this.requestClaude({ live, editor, last, word: taken.lastWord, prefix: taken.text, wordStrokes: taken.strokes, library, line, at: at - CLAUDE_DELAY_MS });
		} catch (e) {
			console.warn("[ink-blocks] Vorschlag", e);
		}
	}

	private async suggest({ editor, stroke: last, token, at }: Job) {
		const live = () => token === this.token && this.plugin.editors.has(editor) && !editor.busy;
		if (!live()) return this.trace("veraltet");
		const doc = editor.entry.doc;
		const front = writingFront(doc.strokes, last);
		if (!front) return this.trace("kein-wortende");
		// Wörterbuch gleichzeitig zur Erkennung vorbereiten, nicht erst danach.
		const index = this.wordIndex();
		index.catch(() => undefined);
		const glyphs = this.glyphLibrary();
		const context = this.noteContext(editor);
		context.catch(() => undefined);
		// Das Wort davor ist meist schon aus einem früheren Durchlauf bekannt; dann bleibt das Bild schmal und schnell.
		const prevKey = front.previous.length ? wordKey(front.previous) : null;
		const known = prevKey ? this.memo.get(prevKey) : undefined;
		const read = prevKey && known === undefined ? [...front.previous, ...front.strokes] : front.strokes;
		const result = await this.plugin.ocr.recognizeDetailed(read, true);
		if (!result || !live()) return this.trace(result ? "veraltet-nach-lesen" : "keine-engine");
		const seg = result.lines[result.lines.length - 1]?.at(-1);
		const allWords = seg?.result.words;
		const word = allWords?.at(-1);
		if (!seg || !allWords || !word) return this.trace("kein-wort");
		this.remember(wordKey(front.strokes), word.conf >= MIN_CONFIDENCE ? word.text : "");
		const before = allWords.length > 1 ? allWords[allWords.length - 2] : null;
		if (prevKey && known === undefined) this.remember(prevKey, before && before.conf >= MIN_CONFIDENCE ? before.text : "");
		const previous = (known ?? (before && before.conf >= MIN_CONFIDENCE ? before.text : "")) || undefined;
		this.record(this.stats.ms, seg.result.ms);
		this.stats.conf.push(Math.round(word.conf * 100) / 100);
		if (this.stats.conf.length > STATS_KEEP) this.stats.conf.shift();
		const [words, library, note] = await Promise.all([index, glyphs, context]);
		if (!live()) return;
		const wordStrokes = seg.seg.strokes.filter((s) => boxOf([s]).minX >= word.x0);
		const wait = () => new Promise((resolve) => window.setTimeout(resolve, Math.max(0, SETTLE_MS - (performance.now() - at))));
		const continued = this.plugin.settings.claudeEnabled ? this.continuation.next(word.text) : null;
		if (continued) {
			const fitted = this.fit(editor, word.text, continued, wordStrokes, library);
			if (fitted) {
				await wait();
				if (!live()) return;
				this.show(editor, fitted.ghost, last, word.text, fitted.rest);
				this.stats.claudeReused++;
				this.record(this.stats.shownMs, performance.now() - at);
				return;
			}
		}
		const sure = word.conf >= MIN_CONFIDENCE;
		if (!sure) this.stats.tooUnsure++;
		const completion = sure ? words.complete(word.text, { previous, note }) : null;
		if (!completion) {
			if (sure) this.stats.noWord++;
			this.trace(`lokal-nichts:${Math.round(word.conf * 100)}`);
			if (word.conf >= CLAUDE_MIN_CONFIDENCE) this.requestClaude({ live, editor, last, word: word.text, prefix: word.text, wordStrokes, library, line: front.line, at });
			return;
		}
		const fitted = this.fit(editor, word.text, completion.rest, wordStrokes, library);
		if (!fitted) return;
		await wait();
		if (!live()) return;
		this.show(editor, fitted.ghost, last, word.text, fitted.rest);
		if (completion.byContext) this.stats.byContext++;
		this.record(this.stats.shownMs, performance.now() - at);
	}

	private show(editor: InkEditor, ghost: Ghost, last: Stroke, word: string, rest: string) {
		const strokes = ghost.strokes.map((points): Stroke => ({ id: shortId(6), tool: "pen", color: last.color, size: last.size, points }));
		window.clearTimeout(this.heldTimer);
		if (this.held && this.held !== editor) this.held.surface.setSuggestion(null);
		this.held = null;
		const lastWord = (word + rest).trim().split(/\s+/).at(-1) ?? word;
		this.active = { editor, ghost, strokes, docStrokes: editor.entry.doc.strokes.length, text: ghost.lastLineText, lastStrokes: strokes.slice(ghost.lastLineFrom), lastWord };
		editor.surface.setSuggestion(strokes);
		this.shownAt = performance.now();
		this.stats.shown++;
		this.trace("gezeigt");
	}

	/** Claude läuft neben den lokalen Vorschlägen her und hält sie nie auf; es wartet höchstens die neueste Frage. */
	private requestClaude(ask: ClaudeAsk) {
		const { settings } = this.plugin;
		if (!settings.claudeEnabled || !settings.claudeToken || Date.now() < this.claudeDownUntil) return this.trace("claude-aus");
		if (this.claudeBusy) {
			this.claudeNext = ask;
			this.trace("claude-wartet");
		} else void this.pumpClaude(ask);
	}

	private async pumpClaude(ask: ClaudeAsk) {
		this.claudeBusy = true;
		try {
			await this.runClaude(ask);
		} catch (e) {
			this.stats.claudeFailed++;
			this.stats.claudeError = e instanceof Error ? e.message.slice(0, 120) : "unbekannt";
			this.claudeDownUntil = Date.now() + CLAUDE_RETRY_MS;
			this.trace("claude-fehler");
		}
		this.claudeBusy = false;
		const next = this.claudeNext;
		this.claudeNext = null;
		if (next?.live()) void this.pumpClaude(next);
	}

	private async runClaude({ live, editor, last, word, prefix, wordStrokes, library, line, at }: ClaudeAsk) {
		// Kurze Pause: Wer gleich weiterschreibt, soll keine Anfrage und kein Limit verbrauchen.
		const pause = Math.max(CLAUDE_DELAY_MS - (performance.now() - at), CLAUDE_MIN_GAP_MS - (performance.now() - this.claudeLast));
		if (pause > 0) await new Promise((resolve) => window.setTimeout(resolve, pause));
		if (!live()) return this.trace("claude-abgebrochen");
		const prompt = await this.claudePrompt(editor, line, word);
		if (!live()) return this.trace("claude-abgebrochen");
		this.trace("claude-frage");
		let reply = this.claudeCache.get(prompt);
		if (reply === undefined) {
			this.claudeLast = performance.now();
			this.stats.claudeAsked++;
			const started = performance.now();
			reply = await askClaude(this.plugin.settings.claudeToken, prompt);
			this.record(this.stats.claudeMs, performance.now() - started);
			this.claudeCache.set(prompt, reply);
			if (this.claudeCache.size > CLAUDE_CACHE) this.claudeCache.delete(this.claudeCache.keys().next().value as string);
		}
		if (!live()) return this.trace("claude-zu-spaet");
		const rest = parseReply(reply);
		if (!rest) return this.trace("claude-leer");
		this.continuation.set(word, rest);
		const fitted = this.fit(editor, prefix, rest, wordStrokes, library);
		if (!fitted) return this.trace("claude-kein-platz");
		this.show(editor, fitted.ghost, last, word, fitted.rest);
		this.stats.claudeShown++;
	}

	/** Thema, Notizanfang, die Zeilen darüber und die aktuelle Zeile bis zum angefangenen Wort. */
	private async claudePrompt(editor: InkEditor, line: Stroke[], word: string): Promise<string> {
		const { app } = this.plugin;
		const file = app.workspace.getActiveFile();
		const note = file?.extension === "md" ? markdownToCorpus(await app.vault.cachedRead(file)).join(" ") : "";
		const doc = editor.entry.doc;
		const cached = doc.ocr ? { ...doc.ocr.lines, ...doc.ocr.fixed } : {};
		const earlier = segmentLines(doc.strokes.filter((s) => !line.some((l) => l.id === s.id))).flat().map((seg) => cached[seg.key] ?? "").filter(Boolean).join(" ");
		const current = line.length > 1 ? ((await this.plugin.ocr.recognizeStrokes(line)) ?? word) : word;
		return buildPrompt({ title: file?.basename ?? "", note, before: `${earlier} ${current}` });
	}

	/** Die eigenen Buchstaben; neu aufgebaut, sobald neue Proben dazugekommen sind. Scheitert das, bleibt die Druckschrift. */
	async glyphLibrary(): Promise<GlyphLibrary> {
		try {
			const samples = await this.plugin.training.load();
			if (this.glyphs?.count !== samples.length) this.glyphs = { count: samples.length, library: buildGlyphLibrary(samples) };
			return this.glyphs.library;
		} catch (e) {
			console.warn("[ink-blocks] Schriftproben", e);
			return new GlyphLibrary();
		}
	}

	/** Wörter der aktiven Notiz (zwischengespeichert, bis sie sich ändert) und das auf dieser Fläche schon Erkannte. */
	private async noteContext(editor: InkEditor): Promise<Map<string, number>> {
		const { app } = this.plugin;
		const file = app.workspace.getActiveFile();
		if (file?.extension === "md" && (this.note?.path !== file.path || this.note.mtime !== file.stat.mtime)) {
			this.note = { path: file.path, mtime: file.stat.mtime, words: countWords(markdownToCorpus(await app.vault.cachedRead(file))) };
		}
		const words = new Map(file?.extension === "md" && this.note ? this.note.words : []);
		return countWords(Object.values(editor.entry.doc.ocr?.lines ?? {}), words);
	}

	private remember(key: string, text: string) {
		this.memo.delete(key);
		this.memo.set(key, text);
		if (this.memo.size > MEMO_SIZE) this.memo.delete(this.memo.keys().next().value as string);
	}

	/** Mehrere Aufrufe teilen sich einen Aufbau. */
	private wordIndex(): Promise<WordIndex> {
		return (this.loading ??= this.loadIndex().finally(() => (this.loading = null)));
	}

	private async loadIndex(): Promise<WordIndex> {
		const { gen, lines } = await this.plugin.ocr.corpusSnapshot();
		if (this.index?.gen === gen) return this.index.words;
		const words = await buildWordIndex(lines);
		this.index = { gen, words };
		return words;
	}

	/** Ablauf fürs Testen auf dem Gerät: Zeitpunkte und Ereignisse, kein Text. */
	private trace(event: string) {
		this.stats.trace.push(`${new Date().toISOString().slice(14, 23)} ${event}`);
		if (this.stats.trace.length > TRACE_KEEP) this.stats.trace.shift();
		this.saveStats();
	}

	private record(list: number[], ms: number) {
		list.push(Math.round(ms));
		if (list.length > STATS_KEEP) list.shift();
		this.saveStats();
	}

	/** Messwerte fürs Testen auf dem Gerät: nur Zeiten und Zähler, kein Text. Nur mit `suggestDebug` in `data.json`. */
	private saveStats() {
		if (!this.plugin.settings.suggestDebug) return;
		window.clearTimeout(this.statsTimer);
		this.statsTimer = window.setTimeout(() => {
			const { manifest, app } = this.plugin;
			const summary = (list: number[]) => {
				const sorted = [...list].sort((a, b) => a - b);
				const at = (q: number) => sorted[Math.floor((sorted.length - 1) * q)] ?? null;
				return { n: sorted.length, median: at(0.5), p90: at(0.9), max: at(1) };
			};
			const report = { ...this.stats, ocr: summary(this.stats.ms), penUpToShown: summary(this.stats.shownMs), claude: summary(this.stats.claudeMs) };
			void app.vault.adapter.write(`${manifest.dir}/${STATS_FILE}`, JSON.stringify(report, null, 1)).catch(() => undefined);
		}, STATS_SAVE_MS);
	}
}
