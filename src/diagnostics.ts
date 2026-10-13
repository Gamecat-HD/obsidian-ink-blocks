import { App, Modal, Notice } from "obsidian";

/**
 * Spike-Werkzeug (Phase 0): prüft, was vom Stift tatsächlich in Obsidian/Electron ankommt –
 * pointerType, Druck, Neigung, Radierer/Seitentaste, coalesced Events, Event-Rate.
 * Einmal unter nativem Wayland und einmal mit --ozone-platform=x11 laufen lassen
 * und den Report nach docs/HARDWARE.md kopieren.
 */

const BUTTON_BARREL = 2;
const BUTTON_ERASER = 32;

interface Stats {
	types: Set<string>;
	moves: number;
	coalesced: number;
	pressures: Set<number>;
	minPressure: number;
	maxPressure: number;
	maxTilt: number;
	maxTwist: number;
	buttons: Set<number>;
	eraser: boolean;
	barrel: boolean;
	maxHz: number;
}

function emptyStats(): Stats {
	return {
		types: new Set(),
		moves: 0,
		coalesced: 0,
		pressures: new Set(),
		minPressure: Infinity,
		maxPressure: 0,
		maxTilt: 0,
		maxTwist: 0,
		buttons: new Set(),
		eraser: false,
		barrel: false,
		maxHz: 0,
	};
}

export class PenDiagnosticsModal extends Modal {
	private stats = emptyStats();
	private moveTimes: number[] = [];
	private last = new Map<number, { x: number; y: number }>();
	private liveEl!: HTMLPreElement;
	private summaryEl!: HTMLPreElement;
	private canvas!: HTMLCanvasElement;
	private ctx!: CanvasRenderingContext2D;
	private pending: PointerEvent | null = null;
	private frame = 0;

	constructor(app: App) {
		super(app);
	}

	onOpen() {
		this.modalEl.addClass("ink-diagnostics-modal");
		this.titleEl.setText("Pen diagnostics");
		const { contentEl } = this;

		contentEl.createEl("p", {
			text: "Mit dem Stift auf die Fläche schreiben: mit wenig und viel Druck, schräg gehalten, mit Radierer-Ende und Seitentaste. Danach „Report kopieren“.",
		});

		const layout = contentEl.createDiv({ cls: "ink-diagnostics-layout" });
		this.canvas = layout.createEl("canvas", { cls: "ink-diagnostics-canvas" });
		const side = layout.createDiv({ cls: "ink-diagnostics-side" });
		this.liveEl = side.createEl("pre", { text: "warte auf Eingabe …" });
		this.summaryEl = side.createEl("pre");

		const actions = contentEl.createDiv({ cls: "ink-diagnostics-actions" });
		actions.createEl("button", { text: "Fläche leeren" }).onclick = () => this.clear();
		actions.createEl("button", { text: "Statistik zurücksetzen" }).onclick = () => {
			this.stats = emptyStats();
			this.renderSummary();
		};
		const copy = actions.createEl("button", { text: "Report kopieren", cls: "mod-cta" });
		copy.onclick = async () => {
			await navigator.clipboard.writeText(this.report());
			new Notice("Pen-Report in die Zwischenablage kopiert");
		};

		const ctx = this.canvas.getContext("2d");
		if (!ctx) throw new Error("Canvas 2D nicht verfügbar");
		this.ctx = ctx;

		this.canvas.addEventListener("pointerdown", this.onDown);
		this.canvas.addEventListener("pointermove", this.onMove);
		this.canvas.addEventListener("pointerup", this.onUp);
		this.canvas.addEventListener("pointercancel", this.onUp);
		this.canvas.addEventListener("contextmenu", (e) => e.preventDefault());

		// Größe erst nach dem Layout des Modals setzen.
		requestAnimationFrame(() => this.resize());
		this.renderSummary();
	}

	onClose() {
		cancelAnimationFrame(this.frame);
		this.contentEl.empty();
	}

	private resize() {
		const dpr = window.devicePixelRatio || 1;
		const rect = this.canvas.getBoundingClientRect();
		this.canvas.width = Math.round(rect.width * dpr);
		this.canvas.height = Math.round(rect.height * dpr);
		this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		this.ctx.lineCap = "round";
		this.ctx.lineJoin = "round";
	}

	private clear() {
		const rect = this.canvas.getBoundingClientRect();
		this.ctx.clearRect(0, 0, rect.width, rect.height);
	}

	private onDown = (e: PointerEvent) => {
		e.preventDefault();
		this.canvas.setPointerCapture(e.pointerId);
		this.last.set(e.pointerId, this.local(e));
		this.record(e);
	};

	private onMove = (e: PointerEvent) => {
		const events = typeof e.getCoalescedEvents === "function" ? e.getCoalescedEvents() : [];
		this.stats.moves++;
		this.stats.coalesced += events.length;
		this.trackRate(e.timeStamp);
		this.record(e);

		if (e.buttons !== 0 || (e.pointerType === "pen" && e.pressure > 0)) {
			for (const ev of events.length ? events : [e]) this.drawSegment(ev);
		}
	};

	private onUp = (e: PointerEvent) => {
		this.last.delete(e.pointerId);
		this.record(e);
	};

	private local(e: PointerEvent) {
		const rect = this.canvas.getBoundingClientRect();
		return { x: e.clientX - rect.left, y: e.clientY - rect.top };
	}

	private drawSegment(e: PointerEvent) {
		const prev = this.last.get(e.pointerId);
		const p = this.local(e);
		this.last.set(e.pointerId, p);
		if (!prev) return;

		const eraser = (e.buttons & BUTTON_ERASER) !== 0;
		const barrel = (e.buttons & BUTTON_BARREL) !== 0;
		const ctx = this.ctx;
		ctx.globalCompositeOperation = eraser ? "destination-out" : "source-over";
		ctx.strokeStyle = barrel ? "#d9480f" : e.pointerType === "touch" ? "#2b8a3e" : "#1c7ed6";
		ctx.lineWidth = eraser ? 24 : 1 + e.pressure * 10;
		ctx.beginPath();
		ctx.moveTo(prev.x, prev.y);
		ctx.lineTo(p.x, p.y);
		ctx.stroke();
	}

	private trackRate(t: number) {
		this.moveTimes.push(t);
		while (this.moveTimes.length && this.moveTimes[0] < t - 1000) this.moveTimes.shift();
		this.stats.maxHz = Math.max(this.stats.maxHz, this.moveTimes.length);
	}

	private record(e: PointerEvent) {
		const s = this.stats;
		s.types.add(e.pointerType);
		s.buttons.add(e.buttons);
		if (e.buttons & BUTTON_ERASER) s.eraser = true;
		if (e.buttons & BUTTON_BARREL) s.barrel = true;
		if (e.pressure > 0) {
			s.pressures.add(Math.round(e.pressure * 4096));
			s.minPressure = Math.min(s.minPressure, e.pressure);
			s.maxPressure = Math.max(s.maxPressure, e.pressure);
		}
		s.maxTilt = Math.max(s.maxTilt, Math.abs(e.tiltX), Math.abs(e.tiltY));
		s.maxTwist = Math.max(s.maxTwist, e.twist);

		this.pending = e;
		if (!this.frame) {
			this.frame = requestAnimationFrame(() => {
				this.frame = 0;
				this.renderLive();
				this.renderSummary();
			});
		}
	}

	private renderLive() {
		const e = this.pending;
		if (!e) return;
		this.liveEl.setText(
			[
				`type      ${e.pointerType} (id ${e.pointerId})`,
				`event     ${e.type}`,
				`pressure  ${e.pressure.toFixed(4)}`,
				`tilt      ${e.tiltX} / ${e.tiltY}`,
				`twist     ${e.twist}`,
				`button(s) ${e.button} / ${e.buttons}`,
				`size      ${e.width.toFixed(1)} × ${e.height.toFixed(1)}`,
			].join("\n"),
		);
	}

	private renderSummary() {
		this.summaryEl.setText(this.summaryLines().join("\n"));
	}

	private summaryLines(): string[] {
		const s = this.stats;
		const avgCoalesced = s.moves ? (s.coalesced / s.moves).toFixed(2) : "–";
		return [
			`pointerTypes     ${[...s.types].join(", ") || "–"}`,
			`Druck min/max    ${s.maxPressure ? `${s.minPressure.toFixed(4)} / ${s.maxPressure.toFixed(4)}` : "–"}`,
			`Druckstufen      ${s.pressures.size} verschiedene Werte`,
			`Neigung max      ${s.maxTilt}°`,
			`Twist max        ${s.maxTwist}°`,
			`Radierer (32)    ${s.eraser ? "ja" : "nein"}`,
			`Seitentaste (2)  ${s.barrel ? "ja" : "nein"}`,
			`buttons-Werte    ${[...s.buttons].sort((a, b) => a - b).join(", ")}`,
			`Move-Rate max    ${s.maxHz} Hz`,
			`coalesced/Move   ${avgCoalesced}`,
		];
	}

	private report(): string {
		const pe = PointerEvent.prototype as Partial<PointerEvent>;
		return [
			`## Pen-Report ${new Date().toISOString()}`,
			"",
			"```",
			`userAgent        ${navigator.userAgent}`,
			`devicePixelRatio ${window.devicePixelRatio}`,
			`getCoalesced     ${typeof pe.getCoalescedEvents === "function"}`,
			`getPredicted     ${typeof pe.getPredictedEvents === "function"}`,
			...this.summaryLines(),
			"```",
		].join("\n");
	}
}
