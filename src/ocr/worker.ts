/**
 * OCR-Worker: läuft als Blob-Modul-Worker (siehe workerClient.ts). Rasterisiert Segmente auf einem
 * OffscreenCanvas und erkennt sie mit onnxruntime-web (Wasm, ein Thread).
 */
import * as ort from "onnxruntime-web/wasm";
import { alignWords } from "./align";
import { editDistance } from "./benchmark";
import { ctcBeamCandidates, ctcBeamSearch, ctcLogLikelihood, prefixScore, type BeamOptions } from "./beam";
import { ctcGreedy } from "./ctc";
import { buildCharLm } from "./lm";
import { toTensor, type HtrConfig } from "./preprocess";
import { rasterizeSegment } from "./raster";
import type { DecoderSetup, RecognizedSegment, RecognizedWord, TuneParams, TuneResult, TuneSample, WorkerRequest, WorkerResponse, WorkerSegment } from "./protocol";
import type { RasterTransform } from "./preprocess";

interface WorkerScope {
	onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null;
	postMessage(message: WorkerResponse): void;
}
const scope = self as unknown as WorkerScope;

let session: ort.InferenceSession | null = null;
let config: HtrConfig | null = null;
/** null = Greedy */
let beam: BeamOptions | null = null;
/** Zweitmodell fürs Ensemble; `map[k]` = Klasse im Zweitmodell zu Klasse k des Hauptmodells (−1 = fehlt). */
let partner: { session: ort.InferenceSession; config: HtrConfig; map: Int32Array; weight: number } | null = null;

function setupDecoder(setup: DecoderSetup | null, cfg: HtrConfig) {
	if (!setup) {
		beam = null;
		return;
	}
	const lm = setup.lines?.length ? buildCharLm(setup.lines, cfg.alphabet, { order: setup.order }) : null;
	beam = { lm, alpha: setup.alpha, beta: lm ? setup.beta : 0, beamWidth: setup.beamWidth, grammar: setup.grammar };
}

/** Je Strichbreiten-Variante die Pixel eines Bildes gleicher Größe. */
function rasterize(seg: WorkerSegment, cfg: HtrConfig) {
	const { canvases, t } = rasterizeSegment(seg, cfg.image_height, cfg.max_width);
	const images = canvases.map(({ ctx }) => ctx.getImageData(0, 0, t.width, cfg.image_height).data);
	return { images, width: t.width, contentWidth: t.contentWidth, t };
}

/** Log-Softmax je Zeitschritt (Ausgabe [.., T, C] flach, Schritt t ab t·C). */
function logSoftmax(data: Float32Array, C: number): Float32Array {
	const out = new Float32Array(data.length);
	for (let base = 0; base < data.length; base += C) {
		let max = -Infinity;
		for (let c = 0; c < C; c++) max = Math.max(max, data[base + c]);
		let sum = 0;
		for (let c = 0; c < C; c++) sum += Math.exp(data[base + c] - max);
		const lse = max + Math.log(sum);
		for (let c = 0; c < C; c++) out[base + c] = data[base + c] - lse;
	}
	return out;
}

/** Log-Wahrscheinlichkeiten eines Modells, gemittelt über alle Bild-Varianten (Test-Time-Augmentation). */
async function runModel(s: ort.InferenceSession, cfg: HtrConfig, images: Uint8ClampedArray[], width: number) {
	const channels = cfg.input_channels ?? 3;
	let sum: Float32Array | null = null;
	let dims: readonly number[] = [];
	for (const px of images) {
		const input = new ort.Tensor("float32", toTensor(px, width, cfg.image_height, cfg), [1, channels, cfg.image_height, width]);
		const out = (await s.run({ [cfg.input_name]: input }))[cfg.output_name];
		dims = out.dims;
		const lp = logSoftmax(out.data as Float32Array, dims[dims.length - 1]);
		if (!sum) sum = lp;
		else for (let i = 0; i < sum.length; i++) sum[i] += lp[i];
	}
	if (!sum) throw new Error("Keine Rasterung");
	if (images.length > 1) for (let i = 0; i < sum.length; i++) sum[i] /= images.length;
	return { lp: sum, dims, T: dims.length === 3 ? (dims[0] === 1 ? dims[1] : dims[0]) : dims[0] };
}

/** Ausgabe des Zweitmodells auf das Alphabet des Hauptmodells abbilden (fehlende Klassen: unmöglich). */
function remap(other: Float32Array, Cp: number, map: Int32Array, T: number, C: number): Float32Array {
	const out = new Float32Array(T * C).fill(-Infinity);
	for (let t = 0; t < T; t++) for (let c = 0; c < C; c++) if (map[c] >= 0) out[t * C + c] = other[t * Cp + map[c]];
	return out;
}

/** So viele Kandidaten je Modell gehen ins Rescoring. */
const NBEST = 8;

/** Dekodier-Ergebnis mit den Lesarten, beste zuerst (fürs Überprüfen). */
interface Decoded {
	text: string;
	confidence: number;
	ranked: string[];
}

const norm = (t: string) => t.replace(/\s+/g, " ").trim();
const NO_BEAM: BeamOptions = { lm: null, alpha: 0, beta: 0, beamWidth: 16, grammar: false };

/**
 * Ensemble per N-Best-Rescoring: Kandidaten beider Modelle sammeln und jeden mit der CTC-Wahrscheinlichkeit
 * beider Modelle (Summe über alle Ausrichtungen – die Modelle setzen ihre Spitzen zu verschiedenen Zeitpunkten,
 * deshalb kein Mischen je Zeitschritt) plus LM bewerten: (1−w)·log P₁ + w·log P₂ + α·log P_lm + β·|Text|.
 */
function ensembleDecode(a: Float32Array, b: Float32Array, dims: number[], cfg: HtrConfig, w: number, validSteps: number, decoder: BeamOptions | null): Decoded {
	const o: BeamOptions = { ...(decoder ?? NO_BEAM), blank: cfg.blank_index, validSteps };
	const texts = new Set<string>();
	let confidence = 0;
	for (const data of [a, b]) {
		const r = ctcBeamCandidates(data, dims, cfg.alphabet, o);
		confidence += r.confidence / 2;
		for (const c of r.candidates.slice(0, NBEST)) texts.add(c.text);
	}
	const ctc = { blank: cfg.blank_index, validSteps };
	const scored = [...texts].map((text) => ({
		text,
		score:
			(1 - w) * ctcLogLikelihood(a, dims, cfg.alphabet, text, ctc) +
			w * ctcLogLikelihood(b, dims, cfg.alphabet, text, ctc) +
			prefixScore(text, cfg.alphabet, o),
	}));
	scored.sort((x, y) => y.score - x.score);
	const ranked = [...new Set(scored.map((c) => norm(c.text)))];
	return { text: ranked[0] ?? "", confidence, ranked };
}

/** Ein Modell allein: Beam-Search (mit LM) bzw. Greedy ohne Dekoder. */
function singleDecode(lp: Float32Array, dims: number[], cfg: HtrConfig, validSteps: number, decoder: BeamOptions | null, ranked: boolean): Decoded {
	const opts = { blank: cfg.blank_index, validSteps };
	if (!decoder) {
		const r = ctcGreedy(lp, dims, cfg.alphabet, opts);
		return { ...r, ranked: [r.text] };
	}
	if (!ranked) {
		const r = ctcBeamSearch(lp, dims, cfg.alphabet, { ...decoder, ...opts });
		return { ...r, ranked: [r.text] };
	}
	const { candidates, confidence } = ctcBeamCandidates(lp, dims, cfg.alphabet, { ...decoder, ...opts });
	const list = [...new Set(candidates.map((c) => norm(c.text)))];
	return { text: list[0] ?? "", confidence, ranked: list };
}

/** Beide Modelle auf einem Segment: Log-Wahrscheinlichkeiten (Zweitmodell aufs Alphabet des Hauptmodells). */
async function logits(seg: WorkerSegment, cfg: HtrConfig) {
	const { images, width, contentWidth, t } = rasterize(seg, cfg);
	const main = await runModel(session!, cfg, images, width);
	const C = main.dims[main.dims.length - 1];
	const dims = [1, main.T, C];
	const validSteps = Math.ceil(contentWidth / cfg.output_stride);
	const other = partner ? await runModel(partner.session, partner.config, images, width) : null;
	// Gleiche Schrittweite → gleich viele Zeitschritte; sonst lieber nur das Hauptmodell.
	const mapped = partner && other && other.T === main.T ? remap(other.lp, other.dims[other.dims.length - 1], partner.map, main.T, C) : null;
	return { main: main.lp, mapped, dims, validSteps, t };
}

function decode(l: Awaited<ReturnType<typeof logits>>, cfg: HtrConfig, weight: number, decoder: BeamOptions | null, ranked: boolean): Decoded {
	if (l.mapped && weight > 0) return ensembleDecode(l.main, l.mapped, l.dims, cfg, weight, l.validSteps, decoder);
	return singleDecode(l.main, l.dims, cfg, l.validSteps, decoder, ranked);
}

/** Wörter des Textes mit Position in Doc-Einheiten (Zeitschritt → x im Zeilenbild → Doc). */
function words(lp: Float32Array, dims: number[], cfg: HtrConfig, text: string, validSteps: number, t: RasterTransform): RecognizedWord[] | undefined {
	const aligned = alignWords(lp, dims, cfg.alphabet, text, { blank: cfg.blank_index, validSteps });
	if (!aligned) return undefined;
	const toDoc = (step: number) => (step * cfg.output_stride - t.offsetX) / t.scale;
	return aligned.map((w) => ({ text: w.text, conf: w.conf, x0: toDoc(w.start), x1: toDoc(w.end) }));
}

async function recognize(segments: WorkerSegment[]): Promise<RecognizedSegment[]> {
	if (!session || !config) throw new Error("Worker nicht initialisiert");
	const cfg = config;
	const results: RecognizedSegment[] = [];
	for (const seg of segments) {
		const t0 = performance.now();
		const l = await logits(seg, cfg);
		const r = decode(l, cfg, partner?.weight ?? 0, beam, !!seg.detail);
		const out: RecognizedSegment = { text: r.text, confidence: r.confidence, ms: 0 };
		if (seg.detail) {
			out.words = words(l.main, l.dims, cfg, r.text, l.validSteps, l.t);
			out.alts = r.ranked.filter((x) => x !== r.text).slice(0, 4);
		}
		out.ms = performance.now() - t0;
		results.push(out);
	}
	return results;
}

/**
 * Abstimmen auf die eigene Schrift: jede Probe einmal durch die Modelle, dann je Parameterkombination
 * decodieren (Beam-Search ist billig gegen das Modell) und die Editierdistanz zählen – getrennt nach
 * Abstimm- und Kontrollproben.
 */
async function tune(samples: TuneSample[], grid: TuneParams[]): Promise<TuneResult[]> {
	if (!session || !config) throw new Error("Worker nicht initialisiert");
	const cfg = config;
	const prepared: { l: Awaited<ReturnType<typeof logits>>[]; text: string; holdout: boolean }[] = [];
	for (const s of samples) {
		const l = [];
		for (const seg of s.segs) l.push(await logits(seg, cfg));
		prepared.push({ l, text: norm(s.text), holdout: s.holdout });
	}
	return grid.map((params) => {
		const decoder: BeamOptions | null = beam ? { ...beam, alpha: params.alpha, beta: beam.lm ? params.beta : 0 } : null;
		const result: TuneResult = { params, tune: { errors: 0, chars: 0 }, holdout: { errors: 0, chars: 0 } };
		for (const p of prepared) {
			const got = norm(p.l.map((l) => decode(l, cfg, params.weight, decoder, false).text).join(" "));
			const bucket = p.holdout ? result.holdout : result.tune;
			bucket.errors += editDistance(p.text, got);
			bucket.chars += Array.from(p.text).length;
		}
		return result;
	});
}

scope.onmessage = async ({ data }) => {
	try {
		if (data.type === "init") {
			ort.env.wasm.wasmBinary = data.wasm;
			ort.env.wasm.numThreads = 1;
			ort.env.wasm.proxy = false;
			session = await ort.InferenceSession.create(new Uint8Array(data.model), { executionProviders: ["wasm"] });
			config = data.config;
			partner = null;
			if (data.partner) {
				const p = data.partner;
				// Klasse k des Hauptmodells ↔ gleiche Zeichen im Zweitmodell (Blank ↔ Blank).
				const index = new Map(Array.from(p.config.alphabet).map((ch, i) => [ch, i + 1]));
				const chars = Array.from(data.config.alphabet);
				const map = new Int32Array(chars.length + 1).fill(-1);
				map[data.config.blank_index] = p.config.blank_index;
				chars.forEach((ch, i) => (map[i + 1] = index.get(ch) ?? -1));
				partner = {
					session: await ort.InferenceSession.create(new Uint8Array(p.model), { executionProviders: ["wasm"] }),
					config: p.config,
					map,
					weight: Math.min(0.95, Math.max(0.05, p.weight)),
				};
			}
			scope.postMessage({ id: data.id, ok: true, result: null });
		} else if (data.type === "decoder") {
			if (!config) throw new Error("Worker nicht initialisiert");
			setupDecoder(data.setup, config);
			scope.postMessage({ id: data.id, ok: true, result: null });
		} else if (data.type === "tune") {
			scope.postMessage({ id: data.id, ok: true, result: await tune(data.samples, data.grid) });
		} else {
			scope.postMessage({ id: data.id, ok: true, result: await recognize(data.segments) });
		}
	} catch (e) {
		scope.postMessage({ id: data.id, ok: false, error: e instanceof Error ? e.message : String(e) });
	}
};
