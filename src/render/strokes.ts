import { getStroke, type StrokeOptions } from "perfect-freehand";
import type { Space, Stroke, Tool } from "../model/ink-format";
import { svgPathFromOutline } from "./svgPath";

/** Palette: 0–2 Stift (0 = Tinte), 3–5 Textmarker. */
export const PALETTE = ["ink", "#1c7ed6", "#e03131", "#fab005", "#40c057", "#f06595"];
export const PEN_COLORS = [0, 1, 2];
export const HL_COLORS = [3, 4, 5];
export const HL_ALPHA = 0.35;

interface StrokeStyle {
	tool: Tool;
	size: number;
	simulated?: boolean;
}

export function strokeOptions(style: StrokeStyle, last: boolean): StrokeOptions {
	if (style.tool === "hl") {
		return { size: style.size, thinning: 0, smoothing: 0.5, streamline: 0.5, simulatePressure: false, last };
	}
	return {
		size: style.size,
		thinning: 0.6,
		smoothing: 0.5,
		streamline: 0.35,
		simulatePressure: !!style.simulated,
		last,
	};
}

function triples(points: number[]): number[][] {
	const out: number[][] = [];
	for (let i = 0; i < points.length; i += 3) out.push([points[i], points[i + 1], points[i + 2]]);
	return out;
}

export function outlinePath(points: number[], style: StrokeStyle, last: boolean): Path2D {
	return new Path2D(svgPathFromOutline(getStroke(triples(points), strokeOptions(style, last))));
}

const pathCache = new WeakMap<Stroke, Path2D>();

/** Path2D in Doc-Einheiten – Striche sind unveränderlich, daher pro Objekt gecacht. */
export function strokePath(stroke: Stroke): Path2D {
	let path = pathCache.get(stroke);
	if (!path) {
		path = outlinePath(stroke.points, stroke, true);
		pathCache.set(stroke, path);
	}
	return path;
}

/** Farbe 0 („Tinte“) folgt im Heft dem Theme, auf Arbeitsblättern ist sie schwarz. */
export function resolveColor(index: number, space: Space, el: HTMLElement): string {
	const color = PALETTE[index] ?? PALETTE[0];
	if (color !== "ink") return color;
	return space === "page" ? "#111" : getComputedStyle(el).getPropertyValue("--text-normal").trim() || "#222";
}
