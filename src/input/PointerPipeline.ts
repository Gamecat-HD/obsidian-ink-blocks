import type InkBlocksPlugin from "../main";
import type { Stroke, Tool } from "../model/ink-format";
import { applyOp, opBounds, pointsBounds, strokeBounds, type InkOp } from "../model/ops";
import { outlinePath } from "../render/strokes";
import type { Surface } from "../render/Surface";
import type { InkEntry } from "../store/InkStore";
import { shortId } from "../util/ids";
import { eraserHits } from "./hitTest";

const BUTTON_BARREL = 2;
const BUTTON_ERASER = 32;
/** Mindestabstand zwischen zwei gespeicherten Punkten (Doc-Einheiten). */
const MIN_STEP = 0.3;
/** Radius des Radierers in Doc-Einheiten. */
const ERASER_RADIUS = 8;
/** So lange nach dem Absetzen des Stifts werden Berührungen noch als Handballen ignoriert. */
const PALM_GRACE_MS = 500;
/** Heft-Modus: kommt der Stift näher als GROW_MARGIN an den unteren Rand, wächst die Fläche um GROW_STEP. */
const GROW_MARGIN = 120;
const GROW_STEP = 300;

type Gesture =
	| {
			kind: "draw";
			pointerId: number;
			tool: Tool;
			color: number;
			size: number;
			simulated: boolean;
			points: number[];
			hStart: number;
	  }
	| {
			kind: "erase";
			pointerId: number;
			x: number;
			y: number;
			removed: Extract<InkOp, { kind: "erase" }>["removed"];
			/** Index jedes Strichs zu Beginn der Geste – damit Undo die Reihenfolge exakt wiederherstellt. */
			origIndex: Map<string, number>;
	  }
	| { kind: "scroll"; pointerId: number; lastY: number; scroller: HTMLElement | null };

/** Übersetzt Pointer-Events auf der Fläche in Striche bzw. Radieren. */
export class PointerPipeline {
	private gesture: Gesture | null = null;
	private penDown = false;
	private penUntil = 0;

	constructor(
		private readonly plugin: InkBlocksPlugin,
		private readonly entry: InkEntry,
		private readonly surface: Surface,
		/** Wird nach jeder abgeschlossenen Änderung aufgerufen. */
		private readonly onOp: (op: InkOp) => void,
		/** Wird bei jedem Stift-/Mauskontakt aufgerufen (Block aktivieren, Fokus für Ctrl+Z). */
		private readonly onActivate: () => void,
	) {
		const el = surface.el;
		el.addEventListener("pointerdown", this.onDown);
		el.addEventListener("pointermove", this.onMove);
		el.addEventListener("pointerup", this.onUp);
		el.addEventListener("pointercancel", this.onCancel);
		// Editor (Live Preview) soll von Klicks in die Fläche nichts mitbekommen.
		for (const type of ["mousedown", "click", "dblclick", "touchstart", "contextmenu"]) {
			el.addEventListener(type, (e) => {
				e.stopPropagation();
				if (type === "contextmenu") e.preventDefault();
			});
		}
	}

	destroy() {
		this.gesture = null;
		this.setDrawing(false);
	}

	get active() {
		return this.gesture !== null;
	}

	private readonly onDown = (e: PointerEvent) => {
		if (this.gesture) return;
		const settings = this.plugin.settings;
		const now = performance.now();

		if (e.pointerType === "touch") {
			const palm = this.penDown || now < this.penUntil;
			if (settings.penOnly || palm) {
				if (!settings.penOnly) return;
				this.capture(e);
				this.gesture = { kind: "scroll", pointerId: e.pointerId, lastY: e.clientY, scroller: this.scroller() };
				return;
			}
		} else if (e.pointerType === "mouse") {
			if (!settings.mouseDraws || e.button !== 0) return;
		} else if (e.pointerType === "pen") {
			this.penDown = true;
		}

		this.capture(e);
		this.onActivate();
		const { x, y } = this.surface.toDoc(e.clientX, e.clientY);
		const tools = settings.tools;
		const erase =
			tools.tool === "eraser" ||
			(e.pointerType === "pen" && ((e.buttons & BUTTON_ERASER) !== 0 || (settings.barrelErases && (e.buttons & BUTTON_BARREL) !== 0)));

		if (erase) {
			const origIndex = new Map(this.entry.doc.strokes.map((st, i) => [st.id, i]));
			this.gesture = { kind: "erase", pointerId: e.pointerId, x, y, removed: [], origIndex };
			this.eraseSegment(x, y, x, y);
			return;
		}

		const hl = tools.tool === "hl";
		const simulated = e.pointerType !== "pen";
		this.gesture = {
			kind: "draw",
			pointerId: e.pointerId,
			tool: hl ? "hl" : "pen",
			color: hl ? tools.hlColor : tools.penColor,
			size: hl ? settings.hlSizes[tools.hlWidth] : settings.penSizes[tools.penWidth],
			simulated,
			points: [x, y, simulated ? 0.5 : e.pressure],
			hStart: this.entry.doc.h,
		};
		this.renderLive();
	};

	private readonly onMove = (e: PointerEvent) => {
		const g = this.gesture;
		if (!g || g.pointerId !== e.pointerId) return;
		e.preventDefault();

		if (g.kind === "scroll") {
			if (g.scroller) g.scroller.scrollTop -= e.clientY - g.lastY;
			g.lastY = e.clientY;
			return;
		}

		const events = typeof e.getCoalescedEvents === "function" ? e.getCoalescedEvents() : [];
		for (const ev of events.length ? events : [e]) {
			const { x, y } = this.surface.toDoc(ev.clientX, ev.clientY);
			if (g.kind === "erase") {
				this.eraseSegment(g.x, g.y, x, y);
				g.x = x;
				g.y = y;
			} else {
				const n = g.points.length;
				if (Math.hypot(x - g.points[n - 3], y - g.points[n - 2]) < MIN_STEP) continue;
				g.points.push(x, y, g.simulated ? 0.5 : ev.pressure);
				this.maybeGrow(y);
			}
		}
		// Synchron malen (wie der Pen-Diagnose-Dialog): Chromium liefert pointermove ohnehin im Frame-Takt.
		if (g.kind === "draw") this.renderLive();
	};

	private readonly onUp = (e: PointerEvent) => {
		const g = this.gesture;
		if (e.pointerType === "pen") {
			this.penDown = false;
			this.penUntil = performance.now() + PALM_GRACE_MS;
		}
		if (!g || g.pointerId !== e.pointerId) return;
		this.gesture = null;
		this.setDrawing(false);

		if (g.kind === "draw") {
			const stroke: Stroke = { id: shortId(6), tool: g.tool, color: g.color, size: g.size, points: g.points };
			// Stifte ohne Druckunterstützung melden durchgehend 0.5 → wie Maus behandeln.
			if (g.simulated || g.points.every((v, i) => i % 3 !== 2 || v === 0.5)) stroke.simulated = true;
			const op: InkOp = { kind: "add", stroke, hBefore: g.hStart, hAfter: this.entry.doc.h };
			applyOp(this.entry.doc, op);
			this.surface.redraw([strokeBounds(stroke)]);
			this.onOp(op);
		} else if (g.kind === "erase" && g.removed.length) {
			this.onOp({ kind: "erase", removed: g.removed });
		}
	};

	private readonly onCancel = (e: PointerEvent) => {
		if (e.pointerType === "pen") this.penDown = false;
		const g = this.gesture;
		if (!g || g.pointerId !== e.pointerId) return;
		this.gesture = null;
		this.setDrawing(false);
		if (g.kind === "draw") {
			this.surface.clearLive();
			if (this.entry.doc.h !== g.hStart) {
				this.entry.doc.h = g.hStart;
				this.surface.resize();
			}
		} else if (g.kind === "erase" && g.removed.length) {
			this.onOp({ kind: "erase", removed: g.removed });
		}
	};

	private maybeGrow(y: number) {
		const doc = this.entry.doc;
		if (doc.space !== "nb" || y < doc.h - GROW_MARGIN) return;
		doc.h += GROW_STEP;
		this.surface.resize();
	}

	/** Während eines Strichs blendet die Werkzeugleiste aus (CSS `.is-drawing`). */
	private setDrawing(on: boolean) {
		this.surface.el.parentElement?.toggleClass("is-drawing", on);
	}

	private capture(e: PointerEvent) {
		e.preventDefault();
		e.stopPropagation();
		this.setDrawing(true);
		try {
			this.surface.el.setPointerCapture(e.pointerId);
		} catch {
			// Pointer nicht (mehr) aktiv – ohne Capture weiterzeichnen.
		}
	}

	private scroller(): HTMLElement | null {
		return this.surface.el.closest<HTMLElement>(".ink-expanded-scroll, .cm-scroller, .markdown-preview-view");
	}

	private renderLive() {
		const g = this.gesture;
		if (g?.kind !== "draw") return;
		this.surface.drawLive({
			path: outlinePath(g.points, g, false),
			bounds: pointsBounds(g.points, g.size),
			color: g.color,
			highlighter: g.tool === "hl",
		});
	}

	private eraseSegment(x1: number, y1: number, x2: number, y2: number) {
		const g = this.gesture;
		if (g?.kind !== "erase") return;
		const doc = this.entry.doc;
		const removed = doc.strokes
			.filter((stroke) => eraserHits(stroke, x1, y1, x2, y2, ERASER_RADIUS))
			.map((stroke) => ({ stroke, index: g.origIndex.get(stroke.id) ?? doc.strokes.length }));
		if (!removed.length) return;
		const op: InkOp = { kind: "erase", removed };
		applyOp(doc, op);
		g.removed.push(...removed);
		this.surface.redraw(opBounds(op));
	}
}
