/**
 * Mehrfinger-Gesten wie in GoodNotes: kurz mit zwei Fingern tippen = Rückgängig, mit drei = Wiederholen;
 * zwei Finger bewegen = Pinch (Zoom/Verschieben in der ausgeklappten Ansicht). Ohne DOM, per Unit-Test prüfbar.
 */

/** Weiter bewegt (CSS-px) ist kein Tippen mehr. */
const TAP_SLOP_PX = 12;
/** Länger gehalten ist kein Tippen mehr. */
const TAP_MS = 400;

export interface Pinch {
	/** Abstand der Finger relativ zum Beginn. */
	scale: number;
	/** Mitte zwischen den Fingern (Clientkoordinaten). */
	cx: number;
	cy: number;
}

interface Finger {
	x0: number;
	y0: number;
	x: number;
	y: number;
}

export class MultiTouch {
	private readonly fingers = new Map<number, Finger>();
	private max = 0;
	private t0 = 0;
	private moved = false;
	private pinchStart: number | null = null;

	get count() {
		return this.fingers.size;
	}

	has(id: number) {
		return this.fingers.has(id);
	}

	/** Finger aufgesetzt; liefert die Zahl der Finger. */
	down(id: number, x: number, y: number, t: number): number {
		if (!this.fingers.size) {
			this.max = 0;
			this.t0 = t;
			this.moved = false;
		}
		this.fingers.set(id, { x0: x, y0: y, x, y });
		this.max = Math.max(this.max, this.fingers.size);
		this.pinchStart = null;
		return this.fingers.size;
	}

	/** Finger bewegt; bei genau zwei Fingern die Pinch-Werte. */
	move(id: number, x: number, y: number): Pinch | null {
		const f = this.fingers.get(id);
		if (!f) return null;
		f.x = x;
		f.y = y;
		if (Math.hypot(x - f.x0, y - f.y0) > TAP_SLOP_PX) this.moved = true;
		if (this.fingers.size !== 2) return null;
		const [a, b] = [...this.fingers.values()];
		const d = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
		if (this.pinchStart === null) this.pinchStart = d;
		return { scale: d / this.pinchStart, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
	}

	/** Finger abgehoben. Sind alle weg und war es ein kurzes Tippen mit 2 bzw. 3 Fingern: die Aktion. */
	up(id: number, t: number): "undo" | "redo" | null {
		if (!this.fingers.delete(id)) return null;
		this.pinchStart = null;
		if (this.fingers.size) return null;
		if (this.moved || t - this.t0 > TAP_MS) return null;
		return this.max === 2 ? "undo" : this.max === 3 ? "redo" : null;
	}

	reset() {
		this.fingers.clear();
		this.pinchStart = null;
	}
}
