import { getStroke, type StrokeOptions } from "perfect-freehand";
import type { InkColor, Space, Stroke, Tool } from "../model/ink-format";
import type { Bounds } from "../model/ops";
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

/** Umriss-Polygon (perfect-freehand) eines Strichs – Grundlage für `outlineToPath`/`outlineChange`. */
export function strokeOutline(points: number[], style: StrokeStyle, last: boolean): number[][] {
	return getStroke(triples(points), strokeOptions(style, last));
}

/** Minimale Schnittstelle von Path2D/CanvasRenderingContext2D (für Tests ohne DOM). */
export interface PathSink {
	moveTo(x: number, y: number): void;
	quadraticCurveTo(cx: number, cy: number, x: number, y: number): void;
	closePath(): void;
}

/**
 * Umriss direkt als Pfad (ohne SVG-String und Parser) – für den Live-Strich, der bei jeder Bewegung neu
 * entsteht. Gleiche Kurven wie `svgPathFromOutline` (M, Q, T-Kette, Z), nur ohne Rundung auf 2 Stellen:
 * Die T-Kette spiegelt den Kontrollpunkt, exakt gerechnet ist das jeweils der Umrisspunkt selbst.
 */
export function outlineToPath(points: number[][], path: PathSink) {
	const len = points.length;
	if (len < 4) return;
	path.moveTo(points[0][0], points[0][1]);
	for (let i = 1; i < len - 1; i++) {
		const a = points[i];
		const b = points[i + 1];
		path.quadraticCurveTo(a[0], a[1], (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
	}
	path.closePath();
}

/**
 * Wo unterscheiden sich zwei Umrisse desselben Live-Strichs? Bei einem wachsenden Strich ändert sich nur das
 * Ende (der Rest des Umrisses ist Punkt für Punkt gleich), also genügt es, diesen Bereich neu zu malen.
 * Liefert die Bounds aller Kurvenstücke, die sich ändern (alter und neuer Umriss), `"same"` bei gleichem
 * Umriss bzw. `null`, wenn sich Anfang oder Schluss des Polygons ändern (dann alles neu malen).
 *
 * Kurvenstück i (siehe `outlineToPath`) hängt von den Punkten i-1, i, i+1 ab und liegt in deren konvexer
 * Hülle. Ändern sich die Punkte [a, e), ändern sich die Stücke a-1 … e: Punkte a-2 … e+1. Alter und neuer
 * Teilpfad haben dieselben Endpunkte, die Füllung kann sich also nur innerhalb dieser Bounds unterscheiden.
 */
export function outlineChange(prev: number[][], next: number[][]): Bounds | "same" | null {
	const n = Math.min(prev.length, next.length);
	let a = 0;
	while (a < n && prev[a][0] === next[a][0] && prev[a][1] === next[a][1]) a++;
	if (a === prev.length && a === next.length) return "same";
	let z = 0;
	while (z < n - a) {
		const p = prev[prev.length - 1 - z];
		const q = next[next.length - 1 - z];
		if (p[0] !== q[0] || p[1] !== q[1]) break;
		z++;
	}
	// Erstes Kurvenstück und die schließende Linie hängen an den Punkten 0–2 bzw. den letzten beiden.
	if (a < 3 || z < 3) return null;
	const b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
	const add = (pts: number[][], from: number, to: number) => {
		for (let i = from; i <= to; i++) {
			const [x, y] = pts[i];
			if (x < b.minX) b.minX = x;
			if (x > b.maxX) b.maxX = x;
			if (y < b.minY) b.minY = y;
			if (y > b.maxY) b.maxY = y;
		}
	};
	add(prev, a - 2, prev.length - z + 1);
	add(next, a - 2, next.length - z + 1);
	return b;
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
