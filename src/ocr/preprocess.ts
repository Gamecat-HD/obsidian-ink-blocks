import type { Box } from "./segment";

/** Relevante Felder aus der config.json der de-htr-Modelle. */
export interface HtrConfig {
	input_name: string;
	output_name: string;
	/** v2: 1 (Graustufen), v1: fehlt → 3 (RGB) */
	input_channels?: number;
	image_height: number;
	max_width: number;
	output_stride: number;
	blank_index: number;
	alphabet: string;
	normalization?: { mean: number[]; std: number[] };
}

export const RASTER_PAD = 4;
/** Strichbreite im 64-px-Zeilenbild – entspricht etwa typischer Handschrift in den Trainingsdaten. */
export const RASTER_STROKE_PX = 2.6;

export interface RasterTransform {
	scale: number;
	offsetX: number;
	offsetY: number;
	/** Bildbreite, auf ein Vielfaches von 4 aufgerundet */
	width: number;
	/** Breite des Inhalts ohne Auffüllung (für die gültigen CTC-Schritte) */
	contentWidth: number;
}

/**
 * Doc-Einheiten → Zeilenbild der Höhe `imageHeight`. Bezug ist die größere aus Segmenthöhe und
 * Referenzhöhe, damit z. B. ein einzelnes „–“ nicht riesig aufgeblasen wird. Vertikal zentriert.
 */
export function rasterTransform(box: Box, refHeight: number, imageHeight: number, maxWidth: number): RasterTransform {
	const inner = imageHeight - 2 * RASTER_PAD;
	const boxH = Math.max(box.maxY - box.minY, 1e-3);
	const boxW = Math.max(box.maxX - box.minX, 1e-3);
	let scale = inner / Math.max(boxH, refHeight * 1.4);
	// Zu breit → verkleinern (sollte durch die Segmentierung selten sein)
	scale = Math.min(scale, (maxWidth - 2 * RASTER_PAD) / boxW);
	const contentWidth = Math.ceil(boxW * scale + 2 * RASTER_PAD);
	const width = Math.min(maxWidth, Math.ceil(contentWidth / 4) * 4);
	const offsetX = RASTER_PAD - box.minX * scale;
	const offsetY = (imageHeight - boxH * scale) / 2 - box.minY * scale;
	return { scale, offsetX, offsetY, width, contentWidth: Math.min(contentWidth, width) };
}

/** RGBA-Pixel → Tensor-Daten. v2: 1 Kanal [0,1]; v1: 3 Kanäle CHW mit ImageNet-Normalisierung. */
export function toTensor(rgba: Uint8ClampedArray, width: number, height: number, config: HtrConfig): Float32Array {
	const n = width * height;
	if ((config.input_channels ?? 3) === 1) {
		const out = new Float32Array(n);
		for (let i = 0; i < n; i++) out[i] = (rgba[i * 4] + rgba[i * 4 + 1] + rgba[i * 4 + 2]) / (3 * 255);
		return out;
	}
	const mean = config.normalization?.mean ?? [0, 0, 0];
	const std = config.normalization?.std ?? [1, 1, 1];
	const out = new Float32Array(3 * n);
	for (let c = 0; c < 3; c++) {
		for (let i = 0; i < n; i++) out[c * n + i] = (rgba[i * 4 + c] / 255 - mean[c]) / std[c];
	}
	return out;
}
