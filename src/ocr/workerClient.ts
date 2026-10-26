import workerCode from "virtual:ocr-worker";
import type { HtrConfig } from "./preprocess";
import type { DecoderSetup, PartnerModel, RecognizedSegment, TuneParams, TuneResult, TuneSample, WorkerRequest, WorkerResponse, WorkerSegment } from "./protocol";

type Result = Extract<WorkerResponse, { ok: true }>["result"];
type Pending = { resolve: (v: Result) => void; reject: (e: Error) => void };
type Payload<T extends WorkerRequest["type"]> = Omit<Extract<WorkerRequest, { type: T }>, "id">;

/** Ein OCR-Worker pro Engine. Der Worker-Code ist ins Plugin gebündelt und läuft als Blob-URL. */
export class OcrWorker {
	private readonly worker: Worker;
	private readonly url: string;
	private seq = 0;
	private readonly pending = new Map<number, Pending>();

	constructor() {
		this.url = URL.createObjectURL(new Blob([workerCode], { type: "text/javascript" }));
		this.worker = new Worker(this.url, { type: "module", name: "ink-blocks-ocr" });
		this.worker.onmessage = ({ data }: MessageEvent<WorkerResponse>) => {
			const p = this.pending.get(data.id);
			if (!p) return;
			this.pending.delete(data.id);
			if (data.ok) p.resolve(data.result);
			else p.reject(new Error(data.error));
		};
		this.worker.onerror = (e) => {
			for (const p of this.pending.values()) p.reject(new Error(e.message || "OCR-Worker abgestürzt"));
			this.pending.clear();
		};
	}

	private call<T extends WorkerRequest["type"]>(msg: Payload<T>, transfer: Transferable[] = []) {
		const id = ++this.seq;
		return new Promise<Result>((resolve, reject) => {
			this.pending.set(id, { resolve, reject });
			this.worker.postMessage({ ...msg, id }, transfer);
		});
	}

	async init(wasm: ArrayBuffer, model: ArrayBuffer, config: HtrConfig, partner?: PartnerModel) {
		await this.call<"init">({ type: "init", wasm, model, config, partner }, partner ? [wasm, model, partner.model] : [wasm, model]);
	}

	/** Dekoder setzen; das LM wird im Worker gebaut. */
	async setDecoder(setup: DecoderSetup | null) {
		await this.call<"decoder">({ type: "decoder", setup });
	}

	async recognize(segments: WorkerSegment[]): Promise<RecognizedSegment[]> {
		return ((await this.call<"recognize">({ type: "recognize", segments })) ?? []) as RecognizedSegment[];
	}

	/** Proben einmal durch die Modelle, dann jede Parameterkombination decodieren und auszählen. */
	async tune(samples: TuneSample[], grid: TuneParams[]): Promise<TuneResult[]> {
		return ((await this.call<"tune">({ type: "tune", samples, grid })) ?? []) as TuneResult[];
	}

	terminate() {
		this.worker.terminate();
		URL.revokeObjectURL(this.url);
		for (const p of this.pending.values()) p.reject(new Error("OCR-Worker beendet"));
		this.pending.clear();
	}
}
