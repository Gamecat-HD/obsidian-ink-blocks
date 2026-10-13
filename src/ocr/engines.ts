import type { HtrConfig } from "./preprocess";
import type { RecognizedSegment, WorkerSegment } from "./protocol";
import { ENGINES, ORT_WASM, type EngineId, type ModelStore } from "./models";
import { OcrWorker } from "./workerClient";

export interface Engine {
	readonly id: string;
	/** Stabile Kennung inkl. Modellversion – ändert sie sich, wird der Zeilen-Cache verworfen. */
	readonly version: string;
	recognize(segments: WorkerSegment[]): Promise<RecognizedSegment[]>;
	dispose(): void;
}

/** de-htr-web (v1/v2) über onnxruntime-web im Worker. */
export class HtrEngine implements Engine {
	readonly version: string;
	private worker: OcrWorker | null = null;
	private ready: Promise<void> | null = null;

	constructor(
		readonly id: EngineId,
		private readonly models: ModelStore,
	) {
		this.version = `${id}@${ENGINES[id].model.sha256.slice(0, 8)}`;
	}

	private load(): Promise<void> {
		if (!this.ready) {
			this.ready = (async () => {
				const spec = ENGINES[this.id];
				const [wasm, model, configBuf] = await Promise.all([
					this.models.read(ORT_WASM),
					this.models.read(spec.model),
					this.models.read(spec.config),
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
			})();
			this.ready.catch(() => (this.ready = null));
		}
		return this.ready;
	}

	async recognize(segments: WorkerSegment[]): Promise<RecognizedSegment[]> {
		await this.load();
		return this.worker!.recognize(segments);
	}

	dispose() {
		this.worker?.terminate();
		this.worker = null;
		this.ready = null;
	}
}
