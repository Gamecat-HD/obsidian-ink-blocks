/**
 * OCR-Worker: läuft als Blob-Modul-Worker (siehe workerClient.ts). Rasterisiert Segmente auf einem
 * OffscreenCanvas und erkennt sie mit onnxruntime-web (Wasm, ein Thread).
 */
import * as ort from "onnxruntime-web/wasm";
import { ctcGreedy } from "./ctc";
import { RASTER_STROKE_PX, rasterTransform, toTensor, type HtrConfig } from "./preprocess";
import type { WorkerRequest, WorkerResponse, WorkerSegment } from "./protocol";

interface WorkerScope {
	onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null;
	postMessage(message: WorkerResponse): void;
}
const scope = self as unknown as WorkerScope;

let session: ort.InferenceSession | null = null;
let config: HtrConfig | null = null;

function rasterize(seg: WorkerSegment, cfg: HtrConfig) {
	const height = cfg.image_height;
	const t = rasterTransform(seg.box, seg.refHeight, height, cfg.max_width);
	const canvas = new OffscreenCanvas(t.width, height);
	const ctx = canvas.getContext("2d");
	if (!ctx) throw new Error("OffscreenCanvas nicht verfügbar");
	ctx.fillStyle = "#fff";
	ctx.fillRect(0, 0, t.width, height);
	ctx.setTransform(t.scale, 0, 0, t.scale, t.offsetX, t.offsetY);
	ctx.strokeStyle = "#000";
	ctx.fillStyle = "#000";
	ctx.lineWidth = RASTER_STROKE_PX / t.scale;
	ctx.lineCap = "round";
	ctx.lineJoin = "round";
	for (const p of seg.strokes) {
		if (p.length <= 3) {
			ctx.beginPath();
			ctx.arc(p[0], p[1], ctx.lineWidth / 2, 0, Math.PI * 2);
			ctx.fill();
			continue;
		}
		ctx.beginPath();
		ctx.moveTo(p[0], p[1]);
		for (let i = 3; i < p.length; i += 3) ctx.lineTo(p[i], p[i + 1]);
		ctx.stroke();
	}
	const pixels = ctx.getImageData(0, 0, t.width, height).data;
	return { tensor: toTensor(pixels, t.width, height, cfg), width: t.width, contentWidth: t.contentWidth };
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
