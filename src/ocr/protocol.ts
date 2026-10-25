import type { HtrConfig } from "./preprocess";
import type { Box } from "./segment";

/** Segment für den Worker: Striche als flache Punktlisten [x, y, p, …] in Doc-Einheiten. */
export interface WorkerSegment {
	strokes: number[][];
	box: Box;
	refHeight: number;
	/** Wie gerastert wird; fehlt → DEFAULT_RASTER. */
	raster?: RasterOptions;
}

/** Rasterung eines Segments für das Modell. */
export interface RasterOptions {
	/**
	 * Strichbreiten (px im 64-px-Zeilenbild). Mehrere → Test-Time-Augmentation: jede Variante läuft durchs
	 * Modell, die Log-Wahrscheinlichkeiten werden je Zeitschritt gemittelt und einmal decodiert.
	 */
	strokePx: number[];
}

/**
 * 2,6 px, eine Variante. Gemessen (docs/RECOGNITION.md, 2026-10-25) und ohne Gewinn verworfen: andere Breiten,
 * mehrere Breiten gemittelt, Begradigen, Kursiv-Aufrichten, Scherungs-Varianten, Glätten, Binarisieren.
 */
export const DEFAULT_RASTER: RasterOptions = { strokePx: [2.6] };

export interface RecognizedSegment {
	text: string;
	confidence: number;
	ms: number;
}

/** Dekodierung im Worker: Beam-Search mit Zeichen-LM aus `lines` (null = kein LM). */
export interface DecoderSetup {
	lines: string[] | null;
	order: number;
	alpha: number;
	beta: number;
	beamWidth: number;
	grammar: boolean;
}

/**
 * Zweitmodell fürs Ensemble (z. B. v1 neben v2): sieht dasselbe Bild, seine Ausgabe wird je Zeitschritt mit der
 * des Hauptmodells verschmolzen (gleiche Höhe und Schrittweite → gleich viele Zeitschritte).
 */
export interface PartnerModel {
	model: ArrayBuffer;
	config: HtrConfig;
	/** Anteil des Zweitmodells (0–1) an der gemischten Wahrscheinlichkeit. */
	weight: number;
}

export type WorkerRequest =
	| { id: number; type: "init"; wasm: ArrayBuffer; model: ArrayBuffer; config: HtrConfig; partner?: PartnerModel }
	| { id: number; type: "decoder"; setup: DecoderSetup | null }
	| { id: number; type: "recognize"; segments: WorkerSegment[] };

export type WorkerResponse =
	| { id: number; ok: true; result: RecognizedSegment[] | null }
	| { id: number; ok: false; error: string };
