import { RASTER_STROKE_PX, rasterTransform, type RasterTransform } from "./preprocess";
import type { WorkerSegment } from "./protocol";

/**
 * Segment schwarz auf weiß auf einen OffscreenCanvas zeichnen (Worker und Hauptthread).
 * Einheitliche Strichbreite – unabhängig von Stiftdruck und Werkzeuggröße.
 */
export function rasterizeSegment(
	seg: WorkerSegment,
	height: number,
	maxWidth: number,
): { canvas: OffscreenCanvas; ctx: OffscreenCanvasRenderingContext2D; t: RasterTransform } {
	const t = rasterTransform(seg.box, seg.refHeight, height, maxWidth);
	const canvas = new OffscreenCanvas(t.width, height);
	const ctx = canvas.getContext("2d");
	if (!ctx) throw new Error("OffscreenCanvas nicht verfügbar");
	ctx.fillStyle = "#fff";
	ctx.fillRect(0, 0, t.width, height);
	ctx.setTransform(t.scale, 0, 0, t.scale, t.offsetX, t.offsetY);
	ctx.strokeStyle = "#000";
	ctx.fillStyle = "#000";
	ctx.lineWidth = ((RASTER_STROKE_PX * height) / 64) / t.scale;
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
	ctx.setTransform(1, 0, 0, 1, 0, 0);
	return { canvas, ctx, t };
}
