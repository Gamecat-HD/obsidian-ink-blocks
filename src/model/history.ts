import type { InkData } from "./ink-format";
import { applyOp, invertOp, type InkOp } from "./ops";

/** Undo/Redo-Stapel aus invertierbaren Ops. */
export class History {
	private undoStack: InkOp[] = [];
	private redoStack: InkOp[] = [];

	constructor(private readonly limit = 200) {}

	get canUndo() {
		return this.undoStack.length > 0;
	}

	get canRedo() {
		return this.redoStack.length > 0;
	}

	push(op: InkOp) {
		this.undoStack.push(op);
		if (this.undoStack.length > this.limit) this.undoStack.shift();
		this.redoStack = [];
	}

	/** Macht die letzte Op rückgängig und gibt sie zurück (für das Neuzeichnen). */
	undo(doc: InkData): InkOp | null {
		const op = this.undoStack.pop();
		if (!op) return null;
		invertOp(doc, op);
		this.redoStack.push(op);
		return op;
	}

	redo(doc: InkData): InkOp | null {
		const op = this.redoStack.pop();
		if (!op) return null;
		applyOp(doc, op);
		this.undoStack.push(op);
		return op;
	}

	clear() {
		this.undoStack = [];
		this.redoStack = [];
	}
}
