import { Notice, Platform } from "obsidian";
import { readBlockField, writeBlockField } from "../block/BlockWriter";
import type InkBlocksPlugin from "../main";
import type { Stroke } from "../model/ink-format";
import type { InkEntry } from "../store/InkStore";
import { fnv1a } from "../util/hash";
import { readLocal, writeLocal } from "../util/local";
import { timeSlicer } from "../util/yield";
import { BENCHMARK_TITLE } from "./benchmark";
import { markdownToCorpus } from "./corpus";
import { HtrEngine, TesseractEngine, type DecoderSource, type Engine } from "./engines";
import { ENGINE_ORDER, ENGINES, HTR_V1, HTR_V2, HTR_V2_FP32, ModelStore, type EngineId, type HtrSpec } from "./models";
import { partnerKey } from "./engines";
import { DEFAULT_RASTER, type RasterOptions, type RecognizedSegment, type TuneParams, type TuneResult, type TuneSample, type WorkerSegment } from "./protocol";
import { referenceHeight, segmentLines, type Segment } from "./segment";
import { isHoldout, labeled } from "../training/samples";

/** Kurzform der Rasterung für die Engine-Version (anderes Rastern → Zeilen-Cache neu). Standard = leer. */
function rasterKey(r: RasterOptions): string {
	const d = DEFAULT_RASTER;
	const key = (o: RasterOptions) => o.strokePx.join("/");
	return key(r) === key(d) ? "" : `+r${key(r)}`;
}

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
/** Anteil von v1 am Ensemble mit v2 – gemessen in scripts/bench/real.mjs bzw. scads.mjs. */
export const ENSEMBLE_WEIGHT = 0.7;

export const DECODER = { order: 6, alpha: 0.35, beta: 1.5, beamWidth: 16, grammar: true };
/** Höchstens so viel Vault-Text fließt ins LM (neueste Notizen zuerst). */
const MAX_CORPUS_CHARS = 4_000_000;
/** Fachbegriffe zählen so oft wie ebenso viele Vorkommen im Vault. */
const HOTWORD_WEIGHT = 20;
/** Sparmodus je Gerät: „1“/„0“; fehlt → an auf Mobilgeräten. */
const LITE_KEY = "ink-blocks-ocr-lite";

/** Sparmodus: nur v2 als int8 (10 MB statt 40 MB), kein Zweitmodell – für Tablets mit wenig Speicher. */
export function ocrLite(): boolean {
	const v = readLocal(LITE_KEY);
	return v === null ? Platform.isMobileApp : v === "1";
}

export function setOcrLite(on: boolean) {
	writeLocal(LITE_KEY, on ? "1" : "0");
}

/** Beim Überprüfen korrigierte Wörter zählen im LM so oft. */
const LEARNED_WEIGHT = 10;
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
	/** Rasterung und Decoder – öffentlich für die Messskripte (scripts/bench/real.mjs); nach Änderung `reset()`. */
	raster: RasterOptions = { ...DEFAULT_RASTER };
	/** v2 als int8 (10 MB) oder fp32 (40 MB, 3–4× schneller in Wasm, gleich genau); „auto“ = fp32, wenn geladen. */
	v2Precision: "auto" | "int8" | "fp32" = "auto";
	/** Anteil von v1 im Ensemble mit v2 (0 = aus). */
	ensembleWeight = ENSEMBLE_WEIGHT;
	decoderParams = { ...DECODER };

	constructor(private readonly plugin: InkBlocksPlugin) {
		this.models = new ModelStore(plugin);
		this.applyTuning();
	}

	/** Abgestimmte Werte aus den Einstellungen übernehmen (oder die eingebauten). Danach `reset()`. */
	applyTuning() {
		const t = this.plugin.settings.ocrTuned;
		this.ensembleWeight = t ? t.weight : ENSEMBLE_WEIGHT;
		this.decoderParams = { ...DECODER, ...(t ? { alpha: t.alpha, beta: t.beta } : {}) };
	}

	/** Version der zuletzt benutzten Engine (für Proben des Schreibtrainings). */
	get engineVersion(): string {
		return this.lastEngine ? (this.engines.get(this.lastEngine)?.version ?? this.lastEngine) : "";
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
		return { gen: c.gen, setup: { lines: c.lines, ...this.decoderParams } };
	};

	/** Klartext aller Notizen (neueste zuerst, gedeckelt) plus Fachbegriffe aus den Einstellungen. */
	private async collectCorpus(): Promise<string[]> {
		const { vault } = this.plugin.app;
		const files = vault.getMarkdownFiles().sort((a, b) => b.stat.mtime - a.stat.mtime);
		const lines: string[] = [];
		let size = 0;
		// Bis zu 4 Mio. Zeichen: in Häppchen, damit Stifteingaben dazwischen nicht warten müssen
		const slice = timeSlicer();
		for (const file of files) {
			if (size >= MAX_CORPUS_CHARS) break;
			await slice();
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
		lines.push(...(await this.learnedLines()));
		return lines;
	}

	/**
	 * Wörter aus dem Schreibtraining fürs LM: korrigierte zählen wie Fachbegriffe, bestätigte einfach.
	 * Kontrollproben bleiben draußen, sonst würde die Abstimmung ihre eigenen Lösungen kennen.
	 */
	private async learnedLines(): Promise<string[]> {
		if (!this.plugin.settings.ocrLearnCorrections) return [];
		const out: string[] = [];
		for (const s of labeled(await this.plugin.training.load().catch(() => []))) {
			if (s.source !== "review" || isHoldout(s.id)) continue;
			const n = s.text !== s.got ? LEARNED_WEIGHT : 1;
			for (let i = 0; i < n; i++) out.push(s.text);
		}
		return out;
	}

	/** Klartextzeilen des Vaults (wie fürs LM) – Quelle der Diktat-Vorgaben. */
	async corpusLines(): Promise<string[]> {
		return (await this.corpusSnapshot()).lines;
	}

	/** Klartextzeilen mit Generation: Sie ändert sich, sobald die Zeilen neu gesammelt wurden. */
	async corpusSnapshot(): Promise<{ gen: number; lines: string[] }> {
		const { gen, setup } = await this.decoder();
		return { gen, lines: setup.lines ?? [] };
	}

	/** Engines, deren Dateien vollständig vorliegen. */
	async readyEngines(): Promise<EngineId[]> {
		const ready: EngineId[] = [];
		for (const id of ENGINE_ORDER) {
			if ((await this.models.isReady(ENGINES[id])) || (id === "htr-v2" && (await this.models.isReady(HTR_V2_FP32)))) ready.push(id);
		}
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

	private create(id: EngineId, partner: { spec: HtrSpec; weight: number } | null, spec: HtrSpec): Engine {
		let engine = this.engines.get(id);
		if (engine instanceof HtrEngine && (engine.partnerKey !== partnerKey(partner) || !engine.version.includes(spec.model.sha256.slice(0, 8)))) {
			engine.dispose();
			engine = undefined;
		}
		if (!engine) {
			const decoder = this.plugin.settings.ocrLanguageModel ? this.decoder : null;
			engine =
				id === "tesseract"
					? new TesseractEngine(this.models)
					: new HtrEngine(spec, this.models, decoder, rasterKey(this.raster), partner);
			this.engines.set(id, engine);
		}
		return engine;
	}

	/** Modelldateien für eine HTR-Engine: v2 bevorzugt als fp32, wenn vorhanden. */
	private async specFor(id: EngineId): Promise<HtrSpec> {
		if (id !== "htr-v2") return HTR_V1;
		if (this.v2Precision === "fp32") return HTR_V2_FP32;
		if (this.v2Precision === "int8") return HTR_V2;
		if (ocrLite() && !this.plugin.settings.ocrFastModel && (await this.models.isReady(HTR_V2))) return HTR_V2;
		return (await this.models.isReady(HTR_V2_FP32)) ? HTR_V2_FP32 : HTR_V2;
	}

	/**
	 * Bei „Automatisch“ bekommt v2 das Modell v1 als Zweitmodell, wenn es geladen ist (Ensemble per Rescoring,
	 * siehe ENSEMBLE_WEIGHT). Eine von Hand gewählte Engine läuft allein.
	 */
	private async partnerFor(id: EngineId): Promise<{ spec: HtrSpec; weight: number } | null> {
		if (id !== "htr-v2" || this.plugin.settings.ocrEngine !== "auto" || this.ensembleWeight <= 0 || this.failed.has("htr-v1") || ocrLite()) return null;
		return (await this.models.isReady(HTR_V1)) ? { spec: HTR_V1, weight: this.ensembleWeight } : null;
	}

	/** Erste bereite, nicht gescheiterte Engine; meldet einen Wechsel auf eine Ausweich-Engine. */
	private async pickEngine(): Promise<Engine | null> {
		const order = this.candidates();
		for (const id of order) {
			const ready = (await this.models.isReady(ENGINES[id])) || (id === "htr-v2" && (await this.models.isReady(HTR_V2_FP32)));
			if (this.failed.has(id) || !ready) continue;
			if (id !== order[0] && id !== this.lastEngine) {
				new Notice(`Texterkennung: ${ENGINES[order[0]].label} nicht verfügbar – nutze ${ENGINES[id].label}.`, 8000);
			}
			this.lastEngine = id;
			return this.create(id, await this.partnerFor(id), await this.specFor(id));
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
				const results = await engine.recognize(this.workerSegments(segs, refHeight));
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

	/** Segmente für den Worker (Striche als Punktlisten). */
	private workerSegments(segs: Segment[], refHeight: number, detail = false, fast = false): WorkerSegment[] {
		return segs.map((seg) => ({ strokes: seg.strokes.map((s) => s.points), box: seg.box, refHeight, raster: this.raster, ...(detail ? { detail } : {}), ...(fast ? { fast } : {}) }));
	}

	/**
	 * Wie `recognizeStrokes`, aber je Segment mit Wörtern (Position, Konfidenz) und Alternativen – fürs
	 * Überprüfen im Schreibtraining. `null` = keine Engine verfügbar. `fast`: nur das Hauptmodell, ohne Alternativen.
	 */
	async recognizeDetailed(strokes: Stroke[], fast = false): Promise<{ engine: string; refHeight: number; lines: { seg: Segment; result: RecognizedSegment }[][] } | null> {
		const lines = segmentLines(strokes);
		const refHeight = referenceHeight(strokes.filter((s) => s.tool === "pen" && !s.shape));
		for (;;) {
			const engine = await this.pickEngine();
			if (!engine) return null;
			const segs = lines.flat();
			try {
				const results = segs.length ? await engine.recognize(this.workerSegments(segs, refHeight, true, fast)) : [];
				const byKey = new Map(segs.map((seg, i) => [seg.key, results[i] ?? { text: "", confidence: 0, ms: 0 }]));
				return { engine: engine.version, refHeight, lines: lines.map((l) => l.map((seg) => ({ seg, result: byKey.get(seg.key)! }))) };
			} catch (e) {
				this.markFailed(engine, e);
			}
		}
	}

	/**
	 * Abstimmen auf die eigene Schrift: Ensemble-Anteil und LM-Gewichte über ein Raster prüfen. Übernommen wird
	 * nur, was auf den Abstimmproben am besten ist UND auf den Kontrollproben nicht schlechter als bisher.
	 */
	async tune(samples: TuneSample[], gridFor: (setup: { ensemble: boolean; lm: boolean }) => TuneParams[]): Promise<TuneResult[] | null> {
		let id: EngineId | undefined;
		for (const c of this.candidates()) {
			if (c === "tesseract" || this.failed.has(c)) continue;
			if ((await this.models.isReady(ENGINES[c])) || (c === "htr-v2" && (await this.models.isReady(HTR_V2_FP32)))) {
				id = c;
				break;
			}
		}
		if (!id) return null;
		const ensemble = id === "htr-v2" && this.plugin.settings.ocrEngine === "auto" && !ocrLite() && !this.failed.has("htr-v1") && (await this.models.isReady(HTR_V1));
		const lm = this.plugin.settings.ocrLanguageModel;
		// Eigene Engine mit Zweitmodell (auch wenn es gerade abgeschaltet ist); die laufenden vorher freigeben.
		this.reset();
		const engine = new HtrEngine(await this.specFor(id), this.models, lm ? this.decoder : null, rasterKey(this.raster), ensemble ? { spec: HTR_V1, weight: 0.5 } : null);
		try {
			return await engine.tune(samples, gridFor({ ensemble, lm }));
		} finally {
			engine.dispose();
		}
	}

	/** Proben → Segmente für `tune` (dieselbe Segmentierung und Rasterung wie im Betrieb). */
	tuneSegments(points: number[][], refHeight: number): WorkerSegment[] {
		const strokes: Stroke[] = points.map((p, i) => ({ id: `s${i}`, tool: "pen", color: 0, size: 3, points: p }));
		return this.workerSegments(segmentLines(strokes).flat(), refHeight);
	}

	/**
	 * Korrektur eines Segments festhalten: gilt, bis sich seine Striche ändern – auch über Engine-Wechsel hinweg.
	 * Den `text:` des Blocks schreibt danach der nächste Lauf.
	 */
	applyCorrection(entry: InkEntry, segKey: string, text: string) {
		const doc = entry.doc;
		doc.ocr ??= { engine: "", lines: {}, written: "" };
		doc.ocr.fixed = { ...doc.ocr.fixed, [segKey]: text };
		this.plugin.store.touch(entry);
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
		// Beim Überprüfen korrigierte Segmente werden nicht neu erkannt.
		const fixed = doc.ocr?.fixed ?? {};
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
			const todo = lines.flat().filter((seg) => !(seg.key in cache) && !(seg.key in fixed));
			if (!todo.length) break;
			try {
				const results = await engine.recognize(this.workerSegments(todo, refHeight));
				todo.forEach((seg, i) => (recognized[seg.key] = results[i]?.text ?? ""));
				break;
			} catch (e) {
				this.markFailed(engine, e);
			}
		}
		const lookup = (key: string) => fixed[key] ?? recognized[key] ?? cache[key] ?? "";
		const text = lines
			.map((segs) => segs.map((s) => lookup(s.key)).filter(Boolean).join(" "))
			.filter(Boolean)
			.join("\n")
			.replace(/`{3,}|~{3,}/g, "");

		// Cache nur mit aktuell vorhandenen Segmenten speichern.
		const lineCache: Record<string, string> = {};
		const keepFixed: Record<string, string> = {};
		for (const seg of lines.flat()) {
			if (seg.key in fixed) keepFixed[seg.key] = fixed[seg.key];
			else lineCache[seg.key] = lookup(seg.key);
		}
		const written = doc.ocr?.written ?? "";
		const cacheChanged =
			doc.ocr?.engine !== engine.version ||
			JSON.stringify(doc.ocr?.lines) !== JSON.stringify(lineCache) ||
			JSON.stringify(doc.ocr?.fixed ?? {}) !== JSON.stringify(keepFixed);
		doc.ocr = { engine: engine.version, lines: lineCache, written };
		if (Object.keys(keepFixed).length) doc.ocr.fixed = keepFixed;

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
			// Von Hand geänderter Text bleibt – aber der Block zeigt an, dass eine neuere Erkennung bereitliegt.
			entry.ocrPending = text;
			this.plugin.refreshCaptions(entry);
			return "user-edited";
		}
		if (entry.ocrPending !== undefined) {
			entry.ocrPending = undefined;
			this.plugin.refreshCaptions(entry);
		}
		if (target.busy()) return "busy";

		target.beforeWrite?.();
		const ok = await writeBlockField(this.plugin.app, target.notePath, target.inkPath, "text", text || undefined, target.hint());
		doc.ocr.written = fnv1a(text);
		this.plugin.store.touch(entry);
		return ok ? "written" : "missing";
	}
}
