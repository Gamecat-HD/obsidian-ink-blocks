import type { HtrConfig } from "./preprocess";
import type { Box } from "./segment";

/** Segment für den Worker: Striche als flache Punktlisten [x, y, p, …] in Doc-Einheiten. */
export interface WorkerSegment {
	strokes: number[][];
	box: Box;
	refHeight: number;
}

export interface RecognizedSegment {
	text: string;
	confidence: number;
	ms: number;
}

export type WorkerRequest =
	| { id: number; type: "init"; wasm: ArrayBuffer; model: ArrayBuffer; config: HtrConfig }
	| { id: number; type: "recognize"; segments: WorkerSegment[] };

export type WorkerResponse =
	| { id: number; ok: true; result: RecognizedSegment[] | null }
	| { id: number; ok: false; error: string };
