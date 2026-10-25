import type InkBlocksPlugin from "../main";
import type { Stroke, Tool } from "../model/ink-format";
import { applyOp, opBounds, pointsBounds, replaceOp, strokeBounds, type Bounds, type InkOp } from "../model/ops";
import { GROW_MARGIN, GROW_STEP, lassoSelect } from "../model/selection";
import { recognizeShape, straightLine } from "../model/shapes";
import { outlinePath, TAPE_SIZES } from "../render/strokes";
import { tapeHit, tapeSvg } from "../render/tape";
import type { Surface } from "../render/Surface";
import type { InkEntry } from "../store/InkStore";
import { shortId } from "../util/ids";
import { ERASER_SIZES } from "../settingsData";
import { eraserHits, splitStroke } from "./hitTest";
import type { Selection } from "./Selection";

const BUTTON_BARREL = 2;
const BUTTON_ERASER = 32;
/** Mindestabstand zwischen zwei gespeicherten Punkten (Doc-Einheiten). */
const MIN_STEP = 0.3;
/** So lange nach dem Absetzen des Stifts werden Berührungen noch als Handballen ignoriert. */
const PALM_GRACE_MS = 500;
/** Lasso: neue Punkte erst ab diesem Abstand (CSS-px); kürzere Lassos gelten als Tippen. */
const LASSO_STEP_PX = 3;
const TAP_PX = 6;
/** Formerkennung: so lange (ms) muss der Stift ruhig liegen, bevor der Strich zur Form wird. */
const HOLD_MS = 500;
/** Kleinere Bewegungen (CSS-px) zählen beim Halten nicht – Zittern der Hand. */
const HOLD_SLOP_PX = 4;

type Gesture =
	| {
			kind: "draw";
			pointerId: number;
			tool: Tool;
			color: number;
			size: number;
			simulated: boolean;
			/** Textmarker als gerade Linie (Lineal): Punkte = Strecke vom Start zum Stift. */
			straight: boolean;
			x0: number;
			y0: number;
			/** Zur Form geworden (Halten): weitere Bewegung wird ignoriert. */
			shape: boolean;
			/** Wo der Stift zuletzt merklich stand (Formerkennung). */
			holdX: number;
			holdY: number;
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
			radius: number;
			/** Präzise: berührte Stellen ausschneiden (Striche teilen) statt ganze Striche zu entfernen. */
			precise: boolean;
			hlOnly: boolean;
			/** Präzise: Strichliste vor der Geste und die dabei entstandenen Stücke. */
			snapshot: Stroke[];
			pieces: Map<string, Stroke>;
	  }
	| { kind: "scroll"; pointerId: number; lastY: number; scroller: HTMLElement | null; x0: number; y0: number; t0: number }
	| { kind: "tap"; pointerId: number; pointerType: string; tapeId: string; x: number; y: number; clientX: number; clientY: number; pressure: number }
	| { kind: "lasso"; pointerId: number; poly: number[]; clientX: number; clientY: number; tap: boolean }
	| { kind: "move"; pointerId: number; x0: number; y0: number; hStart: number }
	| { kind: "scale"; pointerId: number; ox: number; oy: number; d0: number; hStart: number };

/** Übersetzt Pointer-Events auf der Fläche in Striche bzw. Radieren. */
export class PointerPipeline {
	private gesture: Gesture | null = null;
	private penDown = false;
	private penUntil = 0;
	private holdTimer = 0;

	constructor(
		private readonly plugin: InkBlocksPlugin,
		private readonly entry: InkEntry,
		private readonly surface: Surface,
		private readonly selection: Selection,
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
		// Capture verloren ohne pointerup (Fokuswechsel, Fenster verdeckt …): Geste abschließen statt sie
		// hängen zu lassen – sonst würde der nächste Strich verworfen bzw. an den alten angehängt.
		el.addEventListener("lostpointercapture", this.onUp);
		// Editor (Live Preview) soll von Klicks in die Fläche nichts mitbekommen.
		for (const type of ["mousedown", "click", "dblclick", "touchstart", "contextmenu"]) {
			el.addEventListener(type, (e) => {
				e.stopPropagation();
				if (type === "contextmenu") e.preventDefault();
			});
		}
		el.addEventListener("contextmenu", (e) => {
			if (this.gesture || (e as PointerEvent).pointerType === "pen") return;
			this.onActivate();
			this.selection.contextMenu(e.clientX, e.clientY, this.surface.toDoc(e.clientX, e.clientY));
		});
	}

	destroy() {
		window.clearTimeout(this.holdTimer);
		this.gesture = null;
		this.setDrawing(false);
	}

	get active() {
		return this.gesture !== null;
	}

	private readonly onDown = (e: PointerEvent) => {
		const settings = this.plugin.settings;
		const now = performance.now();
		const current = this.gesture;
		if (current) {
			// Liegt der Handballen schon auf der Fläche (Scroll-Geste), hat der Stift Vorrang.
			if (e.pointerType === "pen" && current.kind === "scroll") this.abortScroll(current);
			// Gleicher Pointer ohne pointerup dazwischen: alte Geste ist verwaist.
			else if (current.pointerId === e.pointerId) this.onUp(e);
			else return;
		}

		if (e.pointerType === "touch") {
			// Handballen während bzw. kurz nach dem Schreiben: weder zeichnen noch scrollen.
			if (this.penDown || now < this.penUntil) return;
			// Finger verschieben eine Auswahl auch, wenn nur der Stift zeichnet.
			const at = this.surface.toDoc(e.clientX, e.clientY);
			const onSelection = this.selection.hitFrame(at.x, at.y);
			if (settings.penOnly && !onSelection) {
				this.capture(e, false);
				this.gesture = { kind: "scroll", pointerId: e.pointerId, lastY: e.clientY, scroller: this.scroller(), x0: e.clientX, y0: e.clientY, t0: now };
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

		// Auswahl: Griff skaliert, Rahmen verschiebt, daneben tippen wählt ab.
		const sel = this.selection;
		if (sel.active && !erase) {
			const b = sel.bounds;
			if (b && sel.hitHandle(x, y)) {
				const d0 = Math.max(1, Math.hypot(x - b.minX, y - b.minY));
				this.gesture = { kind: "scale", pointerId: e.pointerId, ox: b.minX, oy: b.minY, d0, hStart: this.entry.doc.h };
				return;
			}
			if (sel.hitFrame(x, y)) {
				this.gesture = { kind: "move", pointerId: e.pointerId, x0: x, y0: y, hStart: this.entry.doc.h };
				return;
			}
		}
		if (sel.active) sel.clear();

		if (tools.tool === "lasso" && !erase) {
			this.gesture = { kind: "lasso", pointerId: e.pointerId, poly: [x, y], clientX: e.clientX, clientY: e.clientY, tap: true };
			return;
		}

		if (erase) {
			const strokes = this.entry.doc.strokes;
			const origIndex = new Map(strokes.map((st, i) => [st.id, i]));
			this.gesture = {
				kind: "erase",
				pointerId: e.pointerId,
				x,
				y,
				removed: [],
				origIndex,
				radius: ERASER_SIZES[tools.eraserWidth],
				precise: settings.eraserMode === "precise",
				hlOnly: settings.eraseHlOnly,
				snapshot: strokes.slice(),
				pieces: new Map(),
			};
			this.showEraser(e);
			this.eraseSegment(x, y, x, y);
			return;
		}

		// Tippen aufs Abdeckband deckt auf bzw. zu; wird daraus ein Strich, wird ganz normal gezeichnet.
		const tapeId = this.tapeAt(x, y);
		if (tapeId) {
			this.gesture = { kind: "tap", pointerId: e.pointerId, pointerType: e.pointerType, tapeId, x, y, clientX: e.clientX, clientY: e.clientY, pressure: e.pressure };
			return;
		}
		this.beginDraw(e.pointerId, e.pointerType, x, y, e.pressure);
	};

	private beginDraw(pointerId: number, pointerType: string, x: number, y: number, pressure: number) {
		const settings = this.plugin.settings;
		const tools = settings.tools;
		const hl = tools.tool === "hl";
		const tape = tools.tool === "tape";
		const simulated = pointerType !== "pen";
		this.gesture = {
			kind: "draw",
			pointerId,
			tool: hl ? "hl" : tape ? "tape" : "pen",
			color: hl ? tools.hlColor : tape ? tools.tapeColor : tools.penColor,
			size: hl ? settings.hlSizes[tools.hlWidth] : tape ? TAPE_SIZES[tools.tapeWidth] : settings.penSizes[tools.penWidth],
			simulated,
			// Das Band ist immer gerade (wie mit dem Lineal gezogen).
			straight: (hl && settings.hlStraight) || tape,
			x0: x,
			y0: y,
			shape: false,
			holdX: x,
			holdY: y,
			points: [x, y, simulated ? 0.5 : pressure],
			hStart: this.entry.doc.h,
		};
		this.armHold(x, y);
		this.renderLive();
	}

	/** Oberstes Abdeckband unter (x, y), aufgedeckt oder nicht. */
	private tapeAt(x: number, y: number): string | null {
		const strokes = this.entry.doc.strokes;
		for (let i = strokes.length - 1; i >= 0; i--) {
			const s = strokes[i];
			if (s.tool === "tape" && !this.selection.selectedIds.has(s.id) && tapeHit(s.points, s.size, x, y)) return s.id;
		}
		return null;
	}

	/** Band auf- bzw. zudecken – in allen Ansichten dieser Datei. */
	private toggleTape(id: string) {
		const revealed = this.entry.revealed;
		if (!revealed.delete(id)) revealed.add(id);
		this.plugin.refreshTape(this.entry);
	}

	private readonly onMove = (e: PointerEvent) => {
		const g = this.gesture;
		if (!g) {
			this.hover(e);
			return;
		}
		if (g.pointerId !== e.pointerId) return;
		e.preventDefault();
		if (g.kind === "erase") this.showEraser(e);

		if (g.kind === "scroll") {
			if (g.scroller) g.scroller.scrollTop -= e.clientY - g.lastY;
			g.lastY = e.clientY;
			return;
		}
		if (g.kind === "tap") {
			if (Math.hypot(e.clientX - g.clientX, e.clientY - g.clientY) <= TAP_PX) return;
			this.beginDraw(g.pointerId, g.pointerType, g.x, g.y, g.pressure);
			this.onMove(e);
			return;
		}

		if (g.kind === "lasso") {
			const { x, y } = this.surface.toDoc(e.clientX, e.clientY);
			const n = g.poly.length;
			if (Math.hypot(x - g.poly[n - 2], y - g.poly[n - 1]) * this.surface.docScale < LASSO_STEP_PX) return;
			g.poly.push(x, y);
			if (Math.hypot(e.clientX - g.clientX, e.clientY - g.clientY) > TAP_PX) g.tap = false;
			this.selection.layer.setLasso(g.poly);
			return;
		}
		if (g.kind === "move") {
			const { x, y } = this.surface.toDoc(e.clientX, e.clientY);
			this.selection.moveTo(x - g.x0, y - g.y0);
			return;
		}
		if (g.kind === "scale") {
			const { x, y } = this.surface.toDoc(e.clientX, e.clientY);
			this.selection.scaleTo(Math.hypot(x - g.ox, y - g.oy) / g.d0);
			return;
		}

		if (g.kind === "draw" && g.shape) return;
		if (g.kind === "draw" && g.straight) {
			const { x, y } = this.surface.toDoc(e.clientX, e.clientY);
			g.points = straightLine(g.x0, g.y0, x, y);
			this.maybeGrow(y);
			this.renderLive();
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
		if (g.kind !== "draw") return;
		const n = g.points.length;
		const moved = Math.hypot(g.points[n - 3] - g.holdX, g.points[n - 2] - g.holdY) * this.surface.docScale;
		if (moved > HOLD_SLOP_PX) this.armHold(g.points[n - 3], g.points[n - 2]);
		// Synchron malen (wie der Pen-Diagnose-Dialog): Chromium liefert pointermove ohnehin im Frame-Takt.
		this.renderLive();
	};

	private readonly onUp = (e: PointerEvent) => {
		const g = this.gesture;
		if (e.pointerType === "pen" && e.type !== "lostpointercapture") {
			this.penDown = false;
			this.penUntil = performance.now() + PALM_GRACE_MS;
		}
		if (!g || g.pointerId !== e.pointerId) return;
		this.gesture = null;
		window.clearTimeout(this.holdTimer);
		this.setDrawing(false);

		if (g.kind === "tap") {
			this.toggleTape(g.tapeId);
		} else if (g.kind === "scroll") {
			// Finger kurz getippt (ohne zu scrollen): Abdeckband auf-/zudecken.
			if (Math.hypot(e.clientX - g.x0, e.clientY - g.y0) <= TAP_PX && performance.now() - g.t0 < 500) {
				const { x, y } = this.surface.toDoc(e.clientX, e.clientY);
				const id = this.tapeAt(x, y);
				if (id) this.toggleTape(id);
			}
		} else if (g.kind === "draw") {
			const stroke: Stroke = { id: shortId(6), tool: g.tool, color: g.color, size: g.size, points: g.points };
			if (g.shape) stroke.shape = true;
			// Stifte ohne Druckunterstützung melden durchgehend 0.5 → wie Maus behandeln.
			if (g.simulated || g.points.every((v, i) => i % 3 !== 2 || v === 0.5)) stroke.simulated = true;
			const op: InkOp = { kind: "add", stroke, hBefore: g.hStart, hAfter: this.entry.doc.h };
			applyOp(this.entry.doc, op);
			this.surface.redraw([strokeBounds(stroke)]);
			this.onOp(op);
		} else if (g.kind === "erase") {
			this.finishErase(g);
			if (e.pointerType !== "pen" || e.type === "lostpointercapture") this.hideEraser();
		} else if (g.kind === "lasso") {
			this.selection.layer.setLasso(null);
			const ids = g.tap ? [] : lassoSelect(this.entry.doc.strokes, g.poly);
			if (ids.length) this.selection.set(ids);
			else if (g.tap) this.selection.contextMenu(g.clientX, g.clientY, { x: g.poly[0], y: g.poly[1] }, true);
		} else if (g.kind === "move" || g.kind === "scale") {
			this.selection.commitTransform(g.hStart);
		}
	};

	private readonly onCancel = (e: PointerEvent) => {
		if (e.pointerType === "pen") this.penDown = false;
		const g = this.gesture;
		if (!g || g.pointerId !== e.pointerId) return;
		this.gesture = null;
		window.clearTimeout(this.holdTimer);
		this.setDrawing(false);
		if (g.kind === "draw") {
			this.surface.clearLive();
			if (this.entry.doc.h !== g.hStart) {
				this.entry.doc.h = g.hStart;
				this.surface.resize();
			}
		} else if (g.kind === "erase") {
			this.finishErase(g);
			this.hideEraser();
		} else if (g.kind === "lasso") {
			this.selection.layer.setLasso(null);
		} else if (g.kind === "move" || g.kind === "scale") {
			this.selection.commitTransform(g.hStart);
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

	private capture(e: PointerEvent, drawing = true) {
		e.preventDefault();
		e.stopPropagation();
		if (drawing) this.setDrawing(true);
		try {
			this.surface.el.setPointerCapture(e.pointerId);
		} catch {
			// Pointer nicht (mehr) aktiv – ohne Capture weiterzeichnen.
		}
	}

	private abortScroll(g: Extract<Gesture, { kind: "scroll" }>) {
		this.gesture = null;
		try {
			this.surface.el.releasePointerCapture(g.pointerId);
		} catch {
			// schon freigegeben
		}
	}

	private scroller(): HTMLElement | null {
		return this.surface.el.closest<HTMLElement>(".ink-expanded-scroll, .cm-scroller, .markdown-preview-view");
	}

	/** Haltezeit neu starten: steht der Stift HOLD_MS lang still, wird der Strich zur Form. */
	private armHold(x: number, y: number) {
		const g = this.gesture;
		if (g?.kind !== "draw") return;
		g.holdX = x;
		g.holdY = y;
		window.clearTimeout(this.holdTimer);
		if (!this.plugin.settings.shapeRecognition || g.straight) return;
		this.holdTimer = window.setTimeout(this.onHold, HOLD_MS);
	}

	private readonly onHold = () => {
		const g = this.gesture;
		if (g?.kind !== "draw" || g.shape) return;
		const shape = recognizeShape(g.points);
		if (!shape) return;
		g.points = shape.points;
		g.shape = true;
		this.renderLive();
	};

	private renderLive() {
		const g = this.gesture;
		if (g?.kind !== "draw") return;
		const tape = g.tool === "tape";
		this.surface.drawLive({
			path: tape ? new Path2D() : outlinePath(g.points, g, false),
			bounds: pointsBounds(g.points, g.size),
			color: g.color,
			highlighter: g.tool === "hl",
			tape: tape ? tapeSvg(g.points, g.size) : undefined,
		});
	}

	private eraseSegment(x1: number, y1: number, x2: number, y2: number) {
		const g = this.gesture;
		if (g?.kind !== "erase") return;
		const doc = this.entry.doc;
		const hits = doc.strokes.filter((s) => (!g.hlOnly || s.tool === "hl") && eraserHits(s, x1, y1, x2, y2, g.radius));
		if (!hits.length) return;
		if (!g.precise) {
			const removed = hits.map((stroke) => ({ stroke, index: g.origIndex.get(stroke.id) ?? doc.strokes.length }));
			const op: InkOp = { kind: "erase", removed };
			applyOp(doc, op);
			g.removed.push(...removed);
			this.surface.redraw(opBounds(op));
			return;
		}
		const dirty: Bounds[] = [];
		for (const stroke of hits) {
			const pieces = splitStroke(stroke, x1, y1, x2, y2, g.radius, () => shortId(6));
			if (!pieces) continue;
			doc.strokes.splice(doc.strokes.indexOf(stroke), 1, ...pieces);
			// Ein Stück aus dieser Geste wird wieder geteilt: es war nie gespeichert, also nicht „entfernt“.
			if (!g.pieces.delete(stroke.id)) g.removed.push({ stroke, index: g.origIndex.get(stroke.id) ?? 0 });
			for (const p of pieces) g.pieces.set(p.id, p);
			dirty.push(strokeBounds(stroke));
		}
		if (dirty.length) this.surface.redraw(dirty);
	}

	/** Radier-Geste als eine Op abschließen. Präzise: aus dem Stand vor der Geste neu aufbauen (exakt wie Redo). */
	private finishErase(g: Extract<Gesture, { kind: "erase" }>) {
		if (!g.removed.length) return;
		if (!g.precise) {
			this.onOp({ kind: "erase", removed: g.removed });
			return;
		}
		const doc = this.entry.doc;
		const added = doc.strokes.filter((s) => g.pieces.has(s.id));
		doc.strokes = g.snapshot;
		const op = replaceOp(doc, new Set(g.removed.map((r) => r.stroke.id)), added);
		applyOp(doc, op);
		this.surface.redraw(opBounds(op));
		this.onOp(op);
	}

	// ---- Radierer-Cursor ----

	private eraserEl: HTMLElement | null = null;

	/** Ohne Geste: Kreis zeigen, solange der Radierer gewählt ist und Stift/Maus über der Fläche schweben. */
	private hover(e: PointerEvent) {
		if (e.pointerType === "touch" || this.plugin.settings.tools.tool !== "eraser") return this.hideEraser();
		this.showEraser(e);
	}

	private showEraser(e: PointerEvent) {
		const radius = ERASER_SIZES[this.plugin.settings.tools.eraserWidth] * this.surface.docScale;
		if (!this.eraserEl) {
			this.eraserEl = this.surface.el.createDiv({ cls: "ink-eraser-cursor" });
			this.surface.el.addEventListener("pointerleave", this.onLeave);
		}
		const r = this.surface.el.getBoundingClientRect();
		const el = this.eraserEl;
		el.style.width = el.style.height = `${radius * 2}px`;
		el.style.transform = `translate(${e.clientX - r.left - radius}px, ${e.clientY - r.top - radius}px)`;
		el.style.display = "";
	}

	private hideEraser() {
		if (this.eraserEl) this.eraserEl.style.display = "none";
	}

	private readonly onLeave = () => {
		if (this.gesture?.kind !== "erase") this.hideEraser();
	};
}
