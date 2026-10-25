import { getStroke, type StrokeOptions } from "perfect-freehand";
import type { InkColor, Space, Stroke, Tool } from "../model/ink-format";
import { svgPathFromOutline } from "./svgPath";
import { tapeSvg } from "./tape";

/**
 * Palette: 0–2 Stift (0 = Tinte), ab 3 Textmarker. Indizes stehen in den .ink-Dateien – neue Farben nur
 * hinten anhängen.
 */
export const PALETTE = ["ink", "#1c7ed6", "#e03131", "#fab005", "#40c057", "#f06595", "#4dabf7", "#ff922b", "#b197fc"];
export const PEN_COLORS = [0, 1, 2];
export const HL_COLORS = [3, 4, 5, 6, 7, 8];
export const HL_ALPHA = 0.35;
/** Abdeckband: dieselben Farben wie der Textmarker, aber deckend. */
export const TAPE_COLORS = HL_COLORS;
/** Bandbreiten der drei Slots (Doc-Einheiten): eine Zeile, eine Zeile mit Luft, zwei Zeilen. */
export const TAPE_SIZES: [number, number, number] = [36, 50, 84];
/** Aufgedecktes Band: nur noch angedeutet. */
export const TAPE_REVEALED_ALPHA = 0.16;

interface StrokeStyle {
	tool: Tool;
	size: number;
	simulated?: boolean;
	shape?: boolean;
}

export function strokeOptions(style: StrokeStyle, last: boolean): StrokeOptions {
	if (style.shape) {
		// Saubere Form: keine Glättung (Ecken bleiben scharf), gleichmäßige Breite.
		return { size: style.size, thinning: 0, smoothing: 0, streamline: 0, simulatePressure: false, last };
	}
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

export function outlineSvg(points: number[], style: StrokeStyle, last: boolean): string {
	if (style.tool === "tape") return tapeSvg(points, style.size);
	return svgPathFromOutline(getStroke(triples(points), strokeOptions(style, last)));
}

export function outlinePath(points: number[], style: StrokeStyle, last: boolean): Path2D {
	return new Path2D(outlineSvg(points, style, last));
}

const pathCache = new WeakMap<Stroke, Path2D>();
const svgCache = new WeakMap<Stroke, string>();

/** SVG-Pfad (`d`) in Doc-Einheiten – für die Auswahl-Ebene und den Export. */
export function strokeSvg(stroke: Stroke): string {
	let d = svgCache.get(stroke);
	if (d === undefined) {
		d = outlineSvg(stroke.points, stroke, true);
		svgCache.set(stroke, d);
	}
	return d;
}

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
export function resolveColor(index: InkColor, space: Space, el: HTMLElement): string {
	if (typeof index === "string") return index;
	const color = PALETTE[index] ?? PALETTE[0];
	if (color !== "ink") return color;
	return space === "page" ? "#111" : getComputedStyle(el).getPropertyValue("--text-normal").trim() || "#222";
}
