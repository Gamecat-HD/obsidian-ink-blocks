import type { HtrConfig } from "./preprocess";
import type { DecoderSetup, RecognizedSegment, WorkerSegment } from "./protocol";
import { ORT_WASM, TESSERACT, type EngineId, type HtrSpec, type ModelStore } from "./models";
import { rasterizeSegment } from "./raster";
import { OcrWorker } from "./workerClient";

export interface Engine {
	readonly id: EngineId;
	/** Stabile Kennung inkl. Modellversion – ändert sie sich, wird der Zeilen-Cache verworfen. */
	readonly version: string;
	recognize(segments: WorkerSegment[]): Promise<RecognizedSegment[]>;
	dispose(): void;
}

/** Wiederholbares Laden: schlägt es fehl, wird beim nächsten Aufruf neu versucht. */
function once<T>(fn: () => Promise<T>): () => Promise<T> {
	let p: Promise<T> | null = null;
	return () => {
		if (!p) {
			p = fn();
			p.catch(() => (p = null));
		}
		return p;
	};
}

/** Liefert den Dekoder; `gen` ändert sich, wenn er neu an den Worker gehen muss (z. B. Vault geändert). */
export type DecoderSource = () => Promise<{ gen: number; setup: DecoderSetup }>;

/** de-htr-web (v1/v2) über onnxruntime-web im eigenen Worker; mit `decoder` Beam-Search + Vault-LM statt Greedy. */
export class HtrEngine implements Engine {
	readonly id: EngineId;
	readonly version: string;
	private worker: OcrWorker | null = null;
	private decoderGen: number | null = null;

	constructor(
		private readonly spec: HtrSpec,
		private readonly models: ModelStore,
		private readonly decoder: DecoderSource | null = null,
	) {
		this.id = spec.id;
		this.version = `${spec.id}@${spec.model.sha256.slice(0, 8)}${decoder ? "+lm" : ""}`;
	}

	private readonly load = once(async () => {
		const [wasm, model, configBuf] = await Promise.all([
			this.models.read(ORT_WASM),
			this.models.read(this.spec.model),
			this.models.read(this.spec.config),
		]);
		const config = JSON.parse(new TextDecoder().decode(configBuf)) as HtrConfig;
		const worker = new OcrWorker();
		try {
			await worker.init(wasm, model, config);
		} catch (e) {
			worker.terminate();
			throw e;
		}
		this.worker = worker;
	});

	async recognize(segments: WorkerSegment[]): Promise<RecognizedSegment[]> {
		await this.load();
		if (this.decoder) {
			const { gen, setup } = await this.decoder();
			if (gen !== this.decoderGen) {
				await this.worker!.setDecoder(setup);
				this.decoderGen = gen;
			}
		}
		return this.worker!.recognize(segments);
	}

	dispose() {
		this.worker?.terminate();
		this.worker = null;
		this.decoderGen = null;
	}
}

// Minimal-Typen der tesseract.js-UMD-API (window.Tesseract)
interface TessWorker {
	setParameters(p: Record<string, string>): Promise<unknown>;
	recognize(image: HTMLCanvasElement): Promise<{ data: { text: string; confidence: number } }>;
	terminate(): Promise<unknown>;
}
interface TesseractGlobal {
	createWorker(lang: string, oem: number, options: Record<string, unknown>): Promise<TessWorker>;
}

/** Zeilenhöhe für Tesseract – braucht größere Buchstaben als das HTR-Modell. */
const TESS_HEIGHT = 96;

/**
 * Letzte Stufe: tesseract.js (deu, LSTM). Bibliothek, Worker und Wasm-Kern kommen aus dem
 * Modellordner (Blob-URLs), die Sprachdaten über die Ressourcen-URL des Ordners – ohne CDN.
 */
export class TesseractEngine implements Engine {
	readonly id = "tesseract" as const;
	readonly version = `tesseract@${TESSERACT.lang.sha256.slice(0, 8)}`;
	private worker: TessWorker | null = null;
	private urls: string[] = [];

	constructor(private readonly models: ModelStore) {}

	private async blobUrl(file: typeof TESSERACT.lib): Promise<string> {
		const url = URL.createObjectURL(new Blob([await this.models.read(file)], { type: "text/javascript" }));
		this.urls.push(url);
		return url;
	}

	private async library(): Promise<TesseractGlobal> {
		const w = window as unknown as { Tesseract?: TesseractGlobal };
		if (w.Tesseract) return w.Tesseract;
		const src = await this.blobUrl(TESSERACT.lib);
		await new Promise<void>((resolve, reject) => {
			const script = document.head.createEl("script", { attr: { src } });
			script.onload = () => resolve();
			script.onerror = () => reject(new Error("tesseract.js nicht ladbar"));
		});
		if (!w.Tesseract) throw new Error("tesseract.js nicht ladbar");
		return w.Tesseract;
	}

	private readonly load = once(async () => {
		const T = await this.library();
		const langDir = this.models.abs(TESSERACT.lang).split("/").slice(0, -1).join("/");
		const worker = await T.createWorker("deu", 1, {
			workerPath: await this.blobUrl(TESSERACT.worker),
			// tesseract.js erkennt eine Einzeldatei an der Endung „js“
			corePath: `${await this.blobUrl(TESSERACT.core)}#core.js`,
			workerBlobURL: false,
			langPath: this.models.resourceUrl(langDir),
			cacheMethod: "none",
		});
		await worker.setParameters({ tessedit_pageseg_mode: "7" }); // eine Textzeile
		this.worker = worker;
	});

	async recognize(segments: WorkerSegment[]): Promise<RecognizedSegment[]> {
		await this.load();
		const results: RecognizedSegment[] = [];
		for (const seg of segments) {
			const t0 = performance.now();
			const { canvas } = rasterizeSegment(seg, TESS_HEIGHT, 4096);
			const el = document.createElement("canvas");
			el.width = canvas.width;
			el.height = canvas.height;
			el.getContext("2d")?.drawImage(canvas, 0, 0);
			const { data } = await this.worker!.recognize(el);
			results.push({ text: data.text.replace(/\s+/g, " ").trim(), confidence: data.confidence / 100, ms: performance.now() - t0 });
		}
		return results;
	}

	dispose() {
		void this.worker?.terminate();
		this.worker = null;
		for (const u of this.urls) URL.revokeObjectURL(u);
		this.urls = [];
	}
}
