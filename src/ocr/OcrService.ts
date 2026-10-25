import { Notice } from "obsidian";
import { readBlockField, writeBlockField } from "../block/BlockWriter";
import type InkBlocksPlugin from "../main";
import type { Stroke } from "../model/ink-format";
import type { InkEntry } from "../store/InkStore";
import { fnv1a } from "../util/hash";
import { BENCHMARK_TITLE } from "./benchmark";
import { markdownToCorpus } from "./corpus";
import { HtrEngine, TesseractEngine, type DecoderSource, type Engine } from "./engines";
import { ENGINE_ORDER, ENGINES, HTR_V1, HTR_V2, ModelStore, type EngineId } from "./models";
import { referenceHeight, segmentLines } from "./segment";

/** Wohin das Ergebnis geschrieben wird – ein ink-Block in einer Notiz. */
export interface OcrTarget {
	entry: InkEntry;
	notePath: string;
	inkPath: string;
	/** Aktuelle Zeile des Blocks (Hinweis bei kopierten Blöcken); kann `undefined` liefern. */
	hint: () => number | undefined;
	/** Läuft gerade ein Strich? Dann später nochmal. */
	busy: () => boolean;
	/** Vor dem Schreiben aufgerufen (Fokus aus dem Widget nehmen). */
	beforeWrite?: () => void;
}

export type OcrOutcome = "written" | "unchanged" | "user-edited" | "disabled" | "no-models" | "busy" | "missing";

const RETRY_BUSY_MS = 2000;

/**
 * Beam-Search-Parameter, gemessen auf 1168 ScaDS-Zeilen unbekannter Schreiber (scripts/bench/):
 * α/β auf Val gewählt; Test-CER 8,1 % → 7,0 % schon mit dem fachfremden Vault-LM.
 */
const DECODER = { order: 6, alpha: 0.35, beta: 1.5, beamWidth: 16, grammar: true };
/** Höchstens so viel Vault-Text fließt ins LM (neueste Notizen zuerst). */
const MAX_CORPUS_CHARS = 4_000_000;
/** Fachbegriffe zählen so oft wie ebenso viele Vorkommen im Vault. */
const HOTWORD_WEIGHT = 20;
/** Nach Vault-Änderungen wird das LM frühestens nach dieser Zeit neu gebaut. */
const CORPUS_REFRESH_MS = 10 * 60 * 1000;

/**
 * Handschrift → Text, lokal. Erkennt nach einer Ruhepause nur geänderte Segmente (Cache pro Segment im
 * .ink), setzt den Text zusammen und schreibt ihn ins `text:`-Feld – nur wenn er sich geändert hat und
 * der Nutzer ihn nicht selbst bearbeitet hat.
 */
export class OcrService {
	readonly models: ModelStore;
	private readonly engines = new Map<EngineId, Engine>();
	/** In dieser Sitzung gescheiterte Engines (Laden/Erkennen) – werden übersprungen. */
	private readonly failed = new Set<EngineId>();
	private lastEngine: EngineId | null = null;
	private readonly timers = new Map<string, number>();
	private readonly running = new Map<string, Promise<OcrOutcome>>();
	private warnedMissing = false;
	private corpus: { lines: string[]; at: number; gen: number } | null = null;
	private corpusStale = false;

	constructor(private readonly plugin: InkBlocksPlugin) {
		this.models = new ModelStore(plugin);
	}

	dispose() {
		for (const t of this.timers.values()) window.clearTimeout(t);
		this.timers.clear();
		this.reset();
	}

	/** Engines neu bestimmen (nach Download, Engine-Wechsel in den Einstellungen). */
	reset() {
		for (const e of this.engines.values()) e.dispose();
		this.engines.clear();
		this.failed.clear();
		this.lastEngine = null;
		this.warnedMissing = false;
	}

	/** Vault-Text hat sich geändert: das LM bei Gelegenheit neu bauen. */
	markCorpusStale() {
		this.corpusStale = true;
	}

	/** LM sofort neu bauen (z. B. nach Änderung der Fachbegriffe). */
	invalidateCorpus() {
		this.corpusStale = true;
		if (this.corpus) this.corpus.at = 0;
	}

	private readonly decoder: DecoderSource = async () => {
		let c = this.corpus;
		if (!c || (this.corpusStale && Date.now() - c.at > CORPUS_REFRESH_MS)) {
			this.corpusStale = false;
			c = this.corpus = { lines: await this.collectCorpus(), at: Date.now(), gen: (c?.gen ?? 0) + 1 };
		}
		return { gen: c.gen, setup: { lines: c.lines, ...DECODER } };
	};

	/** Klartext aller Notizen (neueste zuerst, gedeckelt) plus Fachbegriffe aus den Einstellungen. */
	private async collectCorpus(): Promise<string[]> {
		const { vault } = this.plugin.app;
		const files = vault.getMarkdownFiles().sort((a, b) => b.stat.mtime - a.stat.mtime);
		const lines: string[] = [];
		let size = 0;
		for (const file of files) {
			if (size >= MAX_CORPUS_CHARS) break;
			const md = await vault.cachedRead(file);
			// Die OCR-Messnotiz enthält die Vorgabesätze – im LM würde sie die Messung verfälschen.
			if (md.startsWith(BENCHMARK_TITLE)) continue;
			for (const line of markdownToCorpus(md)) {
				lines.push(line);
				size += line.length;
			}
		}
		const hotwords = this.plugin.settings.ocrHotwords.split(/[\n,;]/).map((w) => w.trim()).filter(Boolean);
		for (let i = 0; i < HOTWORD_WEIGHT; i++) lines.push(...hotwords);
		return lines;
	}

	/** Engines, deren Dateien vollständig vorliegen. */
	async readyEngines(): Promise<EngineId[]> {
		const ready: EngineId[] = [];
		for (const id of ENGINE_ORDER) if (await this.models.isReady(ENGINES[id])) ready.push(id);
		return ready;
	}

	/** Engines in der Reihenfolge, in der sie versucht werden. */
	candidates(): EngineId[] {
		const choice = this.plugin.settings.ocrEngine;
		return choice === "auto" ? ENGINE_ORDER : [choice];
	}

	/** Nach einer Änderung: in `ocrDelay` Sekunden erkennen (Timer wird bei jeder Änderung neu gestartet). */
	schedule(target: OcrTarget) {
		if (!this.plugin.settings.ocrEnabled) return;
		window.clearTimeout(this.timers.get(target.inkPath));
		const delay = this.plugin.settings.ocrDelay * 1000;
		this.timers.set(
			target.inkPath,
			window.setTimeout(() => {
				this.timers.delete(target.inkPath);
				void this.run(target).then((outcome) => {
					if (outcome === "busy") window.setTimeout(() => this.schedule(target), RETRY_BUSY_MS);
				});
			}, delay),
		);
	}

	/** Sofort erkennen. `force` überschreibt auch vom Nutzer bearbeiteten Text. */
	run(target: OcrTarget, force = false): Promise<OcrOutcome> {
		// Pro Datei nur ein Lauf gleichzeitig; ein weiterer wartet auf den vorherigen.
		const previous = this.running.get(target.inkPath) ?? Promise.resolve("unchanged" as OcrOutcome);
		const next = previous.catch(() => "unchanged" as OcrOutcome).then(() => this.recognize(target, force));
		this.running.set(target.inkPath, next);
		void next.finally(() => {
			if (this.running.get(target.inkPath) === next) this.running.delete(target.inkPath);
		});
		return next;
	}

	private create(id: EngineId): Engine {
		let engine = this.engines.get(id);
		if (!engine) {
			const decoder = this.plugin.settings.ocrLanguageModel ? this.decoder : null;
			engine = id === "tesseract" ? new TesseractEngine(this.models) : new HtrEngine(id === "htr-v2" ? HTR_V2 : HTR_V1, this.models, decoder);
			this.engines.set(id, engine);
		}
		return engine;
	}

	/** Erste bereite, nicht gescheiterte Engine; meldet einen Wechsel auf eine Ausweich-Engine. */
	private async pickEngine(): Promise<Engine | null> {
		const order = this.candidates();
		for (const id of order) {
			if (this.failed.has(id) || !(await this.models.isReady(ENGINES[id]))) continue;
			if (id !== order[0] && id !== this.lastEngine) {
				new Notice(`Texterkennung: ${ENGINES[order[0]].label} nicht verfügbar – nutze ${ENGINES[id].label}.`, 8000);
			}
			this.lastEngine = id;
			return this.create(id);
		}
		return null;
	}

	private markFailed(engine: Engine, error: unknown) {
		console.warn(`[ink-blocks] OCR-Engine ${engine.id} fehlgeschlagen`, error);
		this.failed.add(engine.id);
		engine.dispose();
		this.engines.delete(engine.id);
	}

	/** Beliebige Striche erkennen, ohne Cache und ohne etwas zu schreiben (Lasso → „In Text umwandeln“). */
	async recognizeStrokes(strokes: Stroke[]): Promise<string | null> {
		const lines = segmentLines(strokes);
		if (!lines.length) return "";
		const refHeight = referenceHeight(strokes.filter((s) => s.tool === "pen" && !s.shape));
		for (;;) {
			const engine = await this.pickEngine();
			if (!engine) return null;
			const segs = lines.flat();
			try {
				const results = await engine.recognize(segs.map((seg) => ({ strokes: seg.strokes.map((s) => s.points), box: seg.box, refHeight })));
				const byKey = new Map(segs.map((seg, i) => [seg.key, results[i]?.text ?? ""]));
				return lines
					.map((l) => l.map((seg) => byKey.get(seg.key)).filter(Boolean).join(" "))
					.filter(Boolean)
					.join("\n");
			} catch (e) {
				this.markFailed(engine, e);
			}
		}
	}

	private async recognize(target: OcrTarget, force: boolean): Promise<OcrOutcome> {
		if (!this.plugin.settings.ocrEnabled && !force) return "disabled";
		if (target.busy()) return "busy";
		const { entry } = target;
		const doc = entry.doc;
		const lines = segmentLines(doc.strokes);
		const refHeight = referenceHeight(doc.strokes.filter((s) => s.tool === "pen" && !s.shape));

		// Engine wählen und erkennen; scheitert sie, die nächste versuchen (eigener Cache je Engine-Version).
		let engine: Engine | null;
		let cache: Record<string, string>;
		const recognized: Record<string, string> = {};
		for (;;) {
			engine = await this.pickEngine();
			if (!engine) {
				if (!this.warnedMissing) {
					this.warnedMissing = true;
					new Notice("Texterkennung: Modelle fehlen noch – Einstellungen → Ink Blocks → „Herunterladen“.", 10000);
				}
				return "no-models";
			}
			cache = doc.ocr?.engine === engine.version ? doc.ocr.lines : {};
			const todo = lines.flat().filter((seg) => !(seg.key in cache));
			if (!todo.length) break;
			try {
				const results = await engine.recognize(
					todo.map((seg) => ({ strokes: seg.strokes.map((s) => s.points), box: seg.box, refHeight })),
				);
				todo.forEach((seg, i) => (recognized[seg.key] = results[i]?.text ?? ""));
				break;
			} catch (e) {
				this.markFailed(engine, e);
			}
		}
		const lookup = (key: string) => recognized[key] ?? cache[key] ?? "";
		const text = lines
			.map((segs) => segs.map((s) => lookup(s.key)).filter(Boolean).join(" "))
			.filter(Boolean)
			.join("\n")
			.replace(/`{3,}|~{3,}/g, "");

		// Cache nur mit aktuell vorhandenen Segmenten speichern.
		const lineCache: Record<string, string> = {};
		for (const seg of lines.flat()) lineCache[seg.key] = lookup(seg.key);
		const written = doc.ocr?.written ?? "";
		const cacheChanged = doc.ocr?.engine !== engine.version || JSON.stringify(doc.ocr?.lines) !== JSON.stringify(lineCache);
		doc.ocr = { engine: engine.version, lines: lineCache, written };

		const current = await readBlockField(this.plugin.app, target.notePath, target.inkPath, "text", target.hint());
		if (current === null) {
			if (cacheChanged) this.plugin.store.touch(entry);
			return "missing";
		}
		const currentText = current ?? "";
		if (currentText === text) {
			doc.ocr.written = fnv1a(text);
			if (cacheChanged || written !== doc.ocr.written) this.plugin.store.touch(entry);
			return "unchanged";
		}
		if (!force && currentText !== "" && fnv1a(currentText) !== written) {
			if (cacheChanged) this.plugin.store.touch(entry);
			return "user-edited";
		}
		if (target.busy()) return "busy";

		target.beforeWrite?.();
		const ok = await writeBlockField(this.plugin.app, target.notePath, target.inkPath, "text", text || undefined, target.hint());
		doc.ocr.written = fnv1a(text);
		this.plugin.store.touch(entry);
		return ok ? "written" : "missing";
	}
}
