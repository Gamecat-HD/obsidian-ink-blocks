import { Modal, setIcon } from "obsidian";
import type { Pinch } from "../input/MultiTouch";
import { InkEditor, type ResolvedBackground } from "../block/InkEditor";
import type InkBlocksPlugin from "../main";
import type { OcrTarget } from "../ocr/OcrService";
import type { Pattern, PatternChange } from "../model/pattern";
import type { InkEntry, InkEvent } from "../store/InkStore";

const ZOOM_STEP = 1.25;
const MAX_ZOOM = 3;
/** Wie `.ink-block.ink-expanded { max-width }` in styles.css. */
const BASE_MAX_WIDTH = 1600;

export interface ExpandOptions {
	plugin: InkBlocksPlugin;
	inkPath: string;
	pattern(): Pattern;
	setPattern(change: PatternChange): void;
	background: ResolvedBackground;
	/** Texterkennung zielt weiter auf den Block in der Notiz. */
	ocrTarget(): OcrTarget | null;
	insertText?(text: string): Promise<boolean>;
}

/**
 * Ausgeklappte Schreibfläche: dieselbe .ink-Datei groß im Fenster (Heft bzw. Arbeitsblatt füllt die
 * Breite, wie hineingezoomt). Änderungen landen sofort im Store, der Block in der Notiz zeichnet mit.
 */
export class ExpandModal extends Modal {
	private editor: InkEditor | null = null;
	private entry: InkEntry | null = null;

	constructor(private readonly opts: ExpandOptions) {
		super(opts.plugin.app);
	}

	async onOpen() {
		const { plugin } = this.opts;
		this.modalEl.addClass("ink-expanded-modal");
		this.titleEl.setText(this.opts.inkPath.split("/").pop() ?? "");
		// Eigene Referenz: der Block in der Notiz kann währenddessen neu gerendert werden (z. B. durch text:).
		this.entry = await plugin.store.acquire(this.opts.inkPath, this.onStoreEvent).catch(() => null);
		if (!this.entry) return this.close();
		const entry = this.entry;
		const header = this.contentEl.createDiv({ cls: "ink-expanded-header" });
		const scroll = this.contentEl.createDiv({ cls: "ink-expanded-scroll" });
		const container = scroll.createDiv({ cls: "ink-block ink-expanded is-active" });
		this.scroll = scroll;
		this.container = container;
		this.editor = new InkEditor(container, {
			plugin,
			entry,
			pattern: () => this.opts.pattern(),
			setPattern: (change) => {
				this.opts.setPattern(change);
				this.editor?.refresh();
			},
			background: this.opts.background,
			commit: () => {
				plugin.store.touch(entry);
				plugin.store.changed(entry, this.onStoreEvent);
				const target = this.opts.ocrTarget();
				if (target) plugin.ocr.schedule(target);
			},
			activate: () => this.editor?.surface.el.focus({ preventScroll: true }),
			toggleExpand: () => this.close(),
			expanded: true,
			insertText: this.opts.insertText,
			pinch: (p) => this.pinch(p),
			pinchEnd: () => (this.pinchFrom = null),
		});
		// Leiste fest im Kopf: beim Zoomen scrollt die Fläche auch seitlich, die Leiste soll stehen bleiben.
		header.appendChild(this.editor.toolbar.el);
		this.buildZoomControls(header);
		scroll.addEventListener("wheel", this.onWheel, { passive: false });
		container.addEventListener("keydown", (e) => {
			if (this.editor?.handleKey(e)) {
				e.preventDefault();
				e.stopPropagation();
			}
		});
		// Eigener Tastatur-Scope des Dialogs: Strg+Z & Co. wirken hier nur auf die Tinte.
		this.scope.register(["Mod"], "z", () => (this.editor?.undo(), false));
		this.scope.register(["Mod", "Shift"], "z", () => (this.editor?.redo(), false));
		this.scope.register(["Mod"], "y", () => (this.editor?.redo(), false));
		this.editor.surface.el.focus({ preventScroll: true });
	}

	// ---- Zoom ----

	private scroll: HTMLElement | null = null;
	private container: HTMLElement | null = null;
	private zoomLabel: HTMLElement | null = null;
	private zoom = 1;
	/** Pinch-Beginn: Zoom und der Punkt der Fläche (relativ 0..1) unter der Fingermitte. */
	private pinchFrom: { zoom: number; rx: number; ry: number } | null = null;

	private buildZoomControls(header: HTMLElement) {
		const box = header.createDiv({ cls: "ink-zoom" });
		const btn = (icon: string, label: string, run: () => void) => {
			const b = box.createEl("button", { cls: "clickable-icon", attr: { "aria-label": label } });
			setIcon(b, icon);
			b.addEventListener("click", run);
			return b;
		};
		btn("zoom-out", "Verkleinern (Strg+Mausrad)", () => this.setZoom(this.zoom / ZOOM_STEP));
		this.zoomLabel = box.createEl("button", { cls: "ink-zoom-label", attr: { "aria-label": "Auf 100 % zurück" } });
		this.zoomLabel.addEventListener("click", () => this.setZoom(1));
		btn("zoom-in", "Vergrößern (Strg+Mausrad, zwei Finger)", () => this.setZoom(this.zoom * ZOOM_STEP));
		this.updateZoomLabel();
	}

	private updateZoomLabel() {
		this.zoomLabel?.setText(`${Math.round(this.zoom * 100)} %`);
	}

	/** Zoom setzen; der Punkt unter `at` (Clientkoordinaten, sonst die Mitte) bleibt, wo er ist. */
	private setZoom(zoom: number, at?: { x: number; y: number }, rel?: { rx: number; ry: number }) {
		const { scroll, container } = this;
		if (!scroll || !container) return;
		const z = Math.min(MAX_ZOOM, Math.max(1, zoom));
		const r = scroll.getBoundingClientRect();
		const ax = (at?.x ?? r.left + r.width / 2) - r.left;
		const ay = (at?.y ?? r.top + r.height / 2) - r.top;
		const point = rel ?? this.relativePoint(ax, ay);
		this.zoom = z;
		if (z === 1) {
			container.style.width = "";
			container.style.maxWidth = "";
		} else {
			container.style.width = `${Math.min(scroll.clientWidth, BASE_MAX_WIDTH) * z}px`;
			container.style.maxWidth = "none";
		}
		scroll.scrollLeft = container.offsetLeft + point.rx * container.offsetWidth - ax;
		scroll.scrollTop = container.offsetTop + point.ry * container.offsetHeight - ay;
		this.updateZoomLabel();
	}

	/** Welcher Punkt der Fläche (relativ 0..1) liegt unter (ax, ay) im Scrollbereich? */
	private relativePoint(ax: number, ay: number) {
		const { scroll, container } = this;
		if (!scroll || !container) return { rx: 0.5, ry: 0 };
		return {
			rx: (scroll.scrollLeft + ax - container.offsetLeft) / Math.max(1, container.offsetWidth),
			ry: (scroll.scrollTop + ay - container.offsetTop) / Math.max(1, container.offsetHeight),
		};
	}

	private readonly onWheel = (e: WheelEvent) => {
		// Strg+Rad bzw. Touchpad-Pinch (Chromium meldet ihn als Strg+Rad).
		if (!e.ctrlKey) return;
		e.preventDefault();
		this.setZoom(this.zoom * Math.exp(-e.deltaY * 0.002), { x: e.clientX, y: e.clientY });
	};

	private pinch(p: Pinch) {
		const scroll = this.scroll;
		if (!scroll) return;
		if (!this.pinchFrom) {
			const r = scroll.getBoundingClientRect();
			this.pinchFrom = { zoom: this.zoom, ...this.relativePoint(p.cx - r.left, p.cy - r.top) };
		}
		const from = this.pinchFrom;
		// Mitte wandert mit (Verschieben), Abstand skaliert (Zoom).
		this.setZoom(from.zoom * p.scale, { x: p.cx, y: p.cy }, from);
	}

	onClose() {
		this.scroll?.removeEventListener("wheel", this.onWheel);
		this.editor?.destroy();
		this.editor = null;
		if (this.entry) this.opts.plugin.store.release(this.entry, this.onStoreEvent);
		this.entry = null;
		this.contentEl.empty();
	}

	private readonly onStoreEvent = (event: InkEvent) => {
		if (event === "deleted") this.close();
		else this.editor?.setDoc();
	};
}
