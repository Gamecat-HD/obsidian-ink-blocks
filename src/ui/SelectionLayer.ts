import { setIcon, setTooltip } from "obsidian";
import type { Stroke } from "../model/ink-format";
import type { Bounds } from "../model/ops";
import type { Transform } from "../model/selection";
import { HL_ALPHA, strokeSvg } from "../render/strokes";
import type { Surface } from "../render/Surface";

const SVG_NS = "http://www.w3.org/2000/svg";
/** Griff zum Skalieren (unten rechts), Trefferradius in CSS-px. */
const HANDLE_HIT_PX = 18;
const BAR_HEIGHT_PX = 40;

export interface SelectionBarAction {
	id: string;
	icon: string;
	label: string;
	run(button: HTMLElement): void;
}

/**
 * Darstellung der Lasso-Auswahl über den Kacheln: Lasso-Linie beim Ziehen, angehobene Striche (SVG, damit
 * Verschieben nur eine Transformation ist), gestrichelter Rahmen mit Skalier-Griff und Aktionsleiste.
 */
export class SelectionLayer {
	readonly svg: SVGSVGElement;
	readonly bar: HTMLElement;
	private readonly lasso: SVGPathElement;
	private readonly group: SVGGElement;
	private readonly frame: SVGRectElement;
	private readonly handle: SVGCircleElement;
	private bounds: Bounds | null = null;

	constructor(
		private readonly surface: Surface,
		actions: SelectionBarAction[],
	) {
		this.svg = document.createElementNS(SVG_NS, "svg");
		this.svg.classList.add("ink-selection");
		this.svg.setAttribute("preserveAspectRatio", "none");
		this.group = this.svg.appendChild(document.createElementNS(SVG_NS, "g"));
		this.group.classList.add("ink-selection-strokes");
		this.lasso = this.svg.appendChild(document.createElementNS(SVG_NS, "path"));
		this.lasso.classList.add("ink-lasso");
		this.frame = this.svg.appendChild(document.createElementNS(SVG_NS, "rect"));
		this.frame.classList.add("ink-selection-frame");
		this.handle = this.svg.appendChild(document.createElementNS(SVG_NS, "circle"));
		this.handle.classList.add("ink-selection-handle");
		surface.el.appendChild(this.svg);

		this.bar = surface.el.createDiv({ cls: "ink-selection-bar" });
		for (const type of ["pointerdown", "mousedown", "click", "touchstart", "dblclick"]) {
			this.bar.addEventListener(type, (e) => {
				e.stopPropagation();
				if (type === "mousedown") e.preventDefault();
			});
		}
		for (const a of actions) {
			const btn = this.bar.createEl("button", { cls: "ink-tb-button clickable-icon" });
			btn.dataset.action = a.id;
			setIcon(btn, a.icon);
			setTooltip(btn, a.label);
			btn.setAttr("aria-label", a.label);
			btn.addEventListener("click", () => a.run(btn));
		}
		this.hide();
	}

	destroy() {
		this.svg.remove();
		this.bar.remove();
	}

	/** viewBox an die Dokumentgröße anpassen (nach Wachsen/Undo). */
	sync() {
		const doc = this.surface.data;
		this.svg.setAttribute("viewBox", `0 0 ${doc.w} ${doc.h}`);
		this.svg.classList.toggle("is-page", doc.space === "page");
		if (this.bounds) this.placeBar(this.bounds);
	}

	/** Lasso-Linie (flach `[x, y, …]`, Doc-Einheiten); `null` entfernt sie. */
	setLasso(poly: number[] | null) {
		this.sync();
		if (!poly || poly.length < 4) {
			this.lasso.removeAttribute("d");
			return;
		}
		let d = `M${poly[0].toFixed(1)},${poly[1].toFixed(1)}`;
		for (let i = 2; i < poly.length; i += 2) d += `L${poly[i].toFixed(1)},${poly[i + 1].toFixed(1)}`;
		this.lasso.setAttribute("d", `${d}Z`);
	}

	/** Angehobene Striche neu aufbauen (nach Auswahl, Umfärben, Einfügen). */
	setStrokes(strokes: Stroke[]) {
		this.group.replaceChildren();
		// Wie auf den Kacheln: Textmarker unter den Stiften.
		const rank = (s: Stroke) => (s.tool === "hl" ? 0 : s.tool === "tape" ? 2 : 1);
		const ordered = [...strokes].sort((a, b) => rank(a) - rank(b));
		for (const s of ordered) {
			const path = this.group.appendChild(document.createElementNS(SVG_NS, "path"));
			path.setAttribute("d", strokeSvg(s));
			path.setAttribute("fill", this.surface.color(s.color));
			if (s.tool === "hl") path.setAttribute("opacity", String(HL_ALPHA));
		}
	}

	/** Rahmen, Griff und Leiste für die (transformierte) Auswahl. */
	show(original: Bounds, t: Transform, dragging: boolean) {
		this.sync();
		const { scale, dx, dy, ox, oy } = t;
		this.group.setAttribute("transform", `translate(${ox + dx} ${oy + dy}) scale(${scale}) translate(${-ox} ${-oy})`);
		const b: Bounds = {
			minX: ox + (original.minX - ox) * scale + dx,
			minY: oy + (original.minY - oy) * scale + dy,
			maxX: ox + (original.maxX - ox) * scale + dx,
			maxY: oy + (original.maxY - oy) * scale + dy,
		};
		this.bounds = b;
		this.svg.style.display = "";
		this.frame.style.display = "";
		this.handle.style.display = "";
		this.frame.setAttribute("x", String(b.minX));
		this.frame.setAttribute("y", String(b.minY));
		this.frame.setAttribute("width", String(Math.max(1, b.maxX - b.minX)));
		this.frame.setAttribute("height", String(Math.max(1, b.maxY - b.minY)));
		this.handle.setAttribute("cx", String(b.maxX));
		this.handle.setAttribute("cy", String(b.maxY));
		this.handle.setAttribute("r", String(7 / this.surface.docScale));
		this.bar.toggleClass("is-hidden", dragging);
		this.placeBar(b);
	}

	/** Nur Lasso sichtbar (beim Ziehen) bzw. gar nichts. */
	hide() {
		this.bounds = null;
		this.group.replaceChildren();
		this.frame.style.display = "none";
		this.handle.style.display = "none";
		this.bar.addClass("is-hidden");
	}

	hitHandle(x: number, y: number): boolean {
		const b = this.bounds;
		if (!b) return false;
		return Math.hypot(x - b.maxX, y - b.maxY) * this.surface.docScale <= HANDLE_HIT_PX;
	}

	hitFrame(x: number, y: number): boolean {
		const b = this.bounds;
		if (!b) return false;
		const pad = 6 / this.surface.docScale;
		return x >= b.minX - pad && x <= b.maxX + pad && y >= b.minY - pad && y <= b.maxY + pad;
	}

	/** Leiste über der Auswahl, sonst darunter, sonst oben in der Auswahl – immer innerhalb der Fläche. */
	private placeBar(b: Bounds) {
		const s = this.surface.docScale;
		const width = this.surface.el.clientWidth;
		const height = this.surface.el.clientHeight;
		const barW = this.bar.offsetWidth || 240;
		let top = b.minY * s - BAR_HEIGHT_PX - 6;
		if (top < 4) top = b.maxY * s + 10;
		if (top > height - BAR_HEIGHT_PX - 4) top = Math.max(4, b.minY * s + 4);
		const left = Math.min(Math.max(4, b.minX * s), Math.max(4, width - barW - 4));
		this.bar.style.left = `${left}px`;
		this.bar.style.top = `${top}px`;
	}
}
