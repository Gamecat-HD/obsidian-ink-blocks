import { rasterTransform, type RasterTransform } from "./preprocess";
import { DEFAULT_RASTER, type RasterOptions, type WorkerSegment } from "./protocol";

/**
 * Segment schwarz auf weiß auf einen OffscreenCanvas zeichnen (Worker und Hauptthread), je Strichbreite aus
 * `raster.strokePx` ein Bild gleicher Größe. Einheitliche Strichbreite – unabhängig von Stiftdruck und Werkzeug.
 */
export function rasterizeSegment(
	seg: WorkerSegment,
	height: number,
	maxWidth: number,
	raster: RasterOptions = seg.raster ?? DEFAULT_RASTER,
): { canvases: { canvas: OffscreenCanvas; ctx: OffscreenCanvasRenderingContext2D }[]; t: RasterTransform } {
	const t = rasterTransform(seg.box, seg.refHeight, height, maxWidth);
	const canvases = raster.strokePx.map((px) => {
		const canvas = new OffscreenCanvas(t.width, height);
		const ctx = canvas.getContext("2d");
		if (!ctx) throw new Error("OffscreenCanvas nicht verfügbar");
		ctx.fillStyle = "#fff";
		ctx.fillRect(0, 0, t.width, height);
		ctx.setTransform(t.scale, 0, 0, t.scale, t.offsetX, t.offsetY);
		ctx.strokeStyle = "#000";
		ctx.fillStyle = "#000";
		ctx.lineWidth = ((px * height) / 64) / t.scale;
		ctx.lineCap = "round";
		ctx.lineJoin = "round";
		// Alle Striche in einem Pfad (deckendes Schwarz – sieht gleich aus, ist bei vielen Strichen viel schneller).
		const dots = new Path2D();
		const lines = new Path2D();
		for (const p of seg.strokes) {
			if (p.length <= 3) {
				dots.moveTo(p[0] + ctx.lineWidth / 2, p[1]);
				dots.arc(p[0], p[1], ctx.lineWidth / 2, 0, Math.PI * 2);
				continue;
			}
			lines.moveTo(p[0], p[1]);
			for (let i = 3; i < p.length; i += 3) lines.lineTo(p[i], p[i + 1]);
		}
		ctx.fill(dots);
		ctx.stroke(lines);
		ctx.setTransform(1, 0, 0, 1, 0, 0);
		return { canvas, ctx };
	});
	return { canvases, t };
}
