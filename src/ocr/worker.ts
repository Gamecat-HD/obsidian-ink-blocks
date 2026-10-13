/**
 * OCR-Worker: läuft als Blob-Modul-Worker (siehe workerClient.ts). Rasterisiert Segmente auf einem
 * OffscreenCanvas und erkennt sie mit onnxruntime-web (Wasm, ein Thread).
 */
import * as ort from "onnxruntime-web/wasm";
import { ctcGreedy } from "./ctc";
import { toTensor, type HtrConfig } from "./preprocess";
import { rasterizeSegment } from "./raster";
import type { WorkerRequest, WorkerResponse, WorkerSegment } from "./protocol";

interface WorkerScope {
	onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null;
	postMessage(message: WorkerResponse): void;
}
const scope = self as unknown as WorkerScope;

let session: ort.InferenceSession | null = null;
let config: HtrConfig | null = null;

function rasterize(seg: WorkerSegment, cfg: HtrConfig) {
	const { ctx, t } = rasterizeSegment(seg, cfg.image_height, cfg.max_width);
	const pixels = ctx.getImageData(0, 0, t.width, cfg.image_height).data;
	return { tensor: toTensor(pixels, t.width, cfg.image_height, cfg), width: t.width, contentWidth: t.contentWidth };
}

async function recognize(segments: WorkerSegment[]) {
	if (!session || !config) throw new Error("Worker nicht initialisiert");
	const cfg = config;
	const channels = cfg.input_channels ?? 3;
	const results: { text: string; confidence: number; ms: number }[] = [];
	for (const seg of segments) {
		const t0 = performance.now();
		const { tensor, width, contentWidth } = rasterize(seg, cfg);
		const input = new ort.Tensor("float32", tensor, [1, channels, cfg.image_height, width]);
		const out = await session.run({ [cfg.input_name]: input });
		const logits = out[cfg.output_name];
		const r = ctcGreedy(logits.data as Float32Array, logits.dims, cfg.alphabet, {
			blank: cfg.blank_index,
			validSteps: Math.ceil(contentWidth / cfg.output_stride),
		});
		results.push({ ...r, ms: performance.now() - t0 });
	}
	return results;
}

scope.onmessage = async ({ data }) => {
	try {
		if (data.type === "init") {
			ort.env.wasm.wasmBinary = data.wasm;
			ort.env.wasm.numThreads = 1;
			ort.env.wasm.proxy = false;
			session = await ort.InferenceSession.create(new Uint8Array(data.model), { executionProviders: ["wasm"] });
			config = data.config;
			scope.postMessage({ id: data.id, ok: true, result: null });
		} else {
			scope.postMessage({ id: data.id, ok: true, result: await recognize(data.segments) });
		}
	} catch (e) {
		scope.postMessage({ id: data.id, ok: false, error: e instanceof Error ? e.message : String(e) });
	}
};
