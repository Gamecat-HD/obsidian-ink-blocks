/**
 * Blame auf einer Zeichenfläche (Zusammenarbeit, z. B. Tandem über `api.setBlame`): Wer hat welchen Strich
 * gezeichnet, und wann?
 *
 * - Jeder Strich bekommt einen weichen Schein in der Farbe der Person (eigene SVG-Ebene über den Kacheln;
 *   pro Person eine Gruppe mit gemeinsamer Deckkraft, damit sich Überlappungen nicht aufaddieren).
 * - Legende oben rechts: Personen mit letzter Änderung. Überfahren einer Person hebt ihre Striche hervor.
 * - Stift/Maus über einem Strich (ohne zu zeichnen): Schild mit Name, Gerät und Zeit; die Striche dieser
 *   Person werden hervorgehoben.
 *
 * Kosten nur, solange Blame an ist: Pfade werden je Strich-ID zwischengespeichert und nur für neue oder
 * entfernte Striche angefasst.
 */
import type { InkData, Stroke } from "../model/ink-format";
import { eraserHits } from "../input/hitTest";
import { strokeSvg } from "./strokes";

/** Siehe api.ts `setBlame`. */
export interface InkBlame {
	authors: { key: string; name: string; color: string; device?: string; you?: boolean }[];
	/** Strich-ID → [Index in `authors`, Zeit in ms oder null]; Striche unbekannter Herkunft fehlen */
	strokes: Record<string, [number, number | null]>;
}

const SVG_NS = "http://www.w3.org/2000/svg";

export interface BlameHost {
	readonly el: HTMLElement;
	readonly data: InkData;
	readonly docScale: number;
	toDoc(clientX: number, clientY: number): { x: number; y: number };
	isHidden(id: string): boolean;
}

export class BlameLayer {
	private readonly svg: SVGSVGElement;
	private readonly legend: HTMLElement;
	private readonly tip: HTMLElement;
	private groups = new Map<number, SVGGElement>();
	/** Strich-ID → [Pfad-Element, Personen-Index] */
	private paths = new Map<string, [SVGPathElement, number]>();
	private blame: InkBlame | null = null;
	private hoverFrame = 0;
	private lastMove: PointerEvent | null = null;
	private focused: number | null = null;
	private lastW = 0;
	private lastH = 0;

	constructor(private readonly host: BlameHost) {
		this.svg = host.el.appendChild(document.createElementNS(SVG_NS, "svg"));
		this.svg.classList.add("ink-blame-layer");
		this.svg.setAttribute("preserveAspectRatio", "none");
		this.legend = host.el.createDiv({ cls: "ink-blame-legend" });
		this.tip = host.el.createDiv({ cls: "ink-blame-tip" });
		this.hide();
		host.el.addEventListener("pointermove", this.onMove, { passive: true });
		host.el.addEventListener("pointerleave", this.onLeave, { passive: true });
	}

	get active() {
		return !!this.blame;
	}

	set(blame: InkBlame | null) {
		const authorsChanged = JSON.stringify(blame?.authors) !== JSON.stringify(this.blame?.authors);
		this.blame = blame;
		if (!blame) return this.hide();
		this.host.el.classList.add("has-blame");
		this.svg.style.display = "";
		this.legend.style.display = "";
		if (authorsChanged) {
			// Personen-Indizes haben sich verschoben → alles neu
			for (const g of this.groups.values()) g.remove();
			this.groups.clear();
			this.paths.clear();
		}
		this.sync();
	}

	/** Nach jeder Änderung am Dokument (neue/gelöschte Striche, Größe). */
	sync() {
		const blame = this.blame;
		if (!blame) return;
		const { w, h, strokes } = this.host.data;
		if (w !== this.lastW || h !== this.lastH) {
			this.svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
			this.lastW = w;
			this.lastH = h;
		}
		const halo = String(5 / (this.host.docScale || 1));
		for (const g of this.groups.values()) g.setAttribute("stroke-width", halo);
		const seen = new Set<string>();
		for (const s of strokes) {
			const b = blame.strokes[s.id];
			if (!b || s.tool === "tape" || this.host.isHidden(s.id)) continue;
			seen.add(s.id);
			const have = this.paths.get(s.id);
			if (have && have[1] === b[0]) continue;
			have?.[0].remove();
			const path = document.createElementNS(SVG_NS, "path");
			path.setAttribute("d", strokeSvg(s));
			path.dataset.id = s.id;
			this.group(b[0]).appendChild(path);
			this.paths.set(s.id, [path, b[0]]);
		}
		for (const [id, [path]] of this.paths) {
			if (seen.has(id)) continue;
			path.remove();
			this.paths.delete(id);
		}
		this.renderLegend();
	}

	private group(i: number): SVGGElement {
		let g = this.groups.get(i);
		if (g) return g;
		const color = this.blame?.authors[i]?.color ?? "#888";
		g = this.svg.appendChild(document.createElementNS(SVG_NS, "g"));
		g.classList.add("ink-blame-author");
		g.dataset.author = String(i);
		g.setAttribute("fill", color);
		g.setAttribute("stroke", color);
		g.setAttribute("stroke-linejoin", "round");
		g.setAttribute("stroke-width", String(5 / (this.host.docScale || 1)));
		this.groups.set(i, g);
		return g;
	}

	private renderLegend() {
		const blame = this.blame;
		if (!blame) return;
		// Letzte Änderung und Anzahl Striche je Person (nur sichtbare Striche zählen)
		const latest = new Map<number, number | null>();
		const count = new Map<number, number>();
		for (const id of this.paths.keys()) {
			const [i, ts] = blame.strokes[id];
			count.set(i, (count.get(i) ?? 0) + 1);
			const prev = latest.get(i);
			if (prev === undefined || (ts !== null && (prev === null || ts > prev))) latest.set(i, ts);
		}
		const order = [...count.keys()].sort((a, b) => (latest.get(b) ?? 0) - (latest.get(a) ?? 0));
		this.legend.empty();
		this.legend.toggleClass("is-empty", order.length === 0);
		for (const i of order) {
			const a = blame.authors[i];
			const ts = latest.get(i) ?? null;
			const chip = this.legend.createDiv({ cls: "ink-blame-chip" });
			chip.style.setProperty("--ink-blame-color", a.color);
			chip.createSpan({ cls: "ink-blame-dot" });
			chip.createSpan({ text: a.you ? "Du" : a.name });
			if (ts !== null) chip.createSpan({ cls: "ink-blame-when", text: relativeTime(ts) });
			chip.setAttr("aria-label", `${a.you ? `Du (${a.name})` : a.name}${a.device ? ` · ${a.device}` : ""}\n${count.get(i)} Striche${ts !== null ? `, zuletzt ${formatTime(ts)}` : ""}`);
			chip.addEventListener("pointerenter", () => this.focus(i));
			chip.addEventListener("pointerleave", () => this.focus(null));
		}
	}

	/** Striche einer Person hervorheben (andere abblenden); `null` = alle gleich. */
	private focus(i: number | null) {
		if (this.focused === i) return;
		this.focused = i;
		this.svg.toggleClass("has-focus", i !== null);
		for (const [k, g] of this.groups) g.toggleClass("is-focused", k === i);
	}

	private onMove = (e: PointerEvent) => {
		if (!this.blame || e.buttons !== 0) {
			if (this.tip.style.display !== "none") this.onLeave();
			return;
		}
		this.lastMove = e;
		if (this.hoverFrame) return;
		this.hoverFrame = requestAnimationFrame(() => {
			this.hoverFrame = 0;
			const ev = this.lastMove;
			if (ev) this.hover(ev);
		});
	};

	private onLeave = () => {
		this.tip.style.display = "none";
		this.focus(null);
	};

	private hover(e: PointerEvent) {
		const blame = this.blame;
		if (!blame) return;
		const { x, y } = this.host.toDoc(e.clientX, e.clientY);
		const r = 6 / (this.host.docScale || 1);
		const strokes = this.host.data.strokes;
		let hit: Stroke | null = null;
		// oberster Strich zuerst
		for (let k = strokes.length - 1; k >= 0; k--) {
			const s = strokes[k];
			if (blame.strokes[s.id] && s.tool !== "tape" && eraserHits(s, x, y, x, y, r)) {
				hit = s;
				break;
			}
		}
		if (!hit) return this.onLeave();
		const [i, ts] = blame.strokes[hit.id];
		const a = blame.authors[i];
		this.focus(i);
		this.tip.empty();
		this.tip.style.setProperty("--ink-blame-color", a.color);
		this.tip.createDiv({ cls: "ink-blame-tip-name", text: `${a.you ? "Du" : a.name}${a.device ? ` · ${a.device}` : ""}` });
		if (ts !== null) this.tip.createDiv({ cls: "ink-blame-tip-when", text: `${relativeTime(ts)} · ${formatTime(ts)}` });
		const box = this.host.el.getBoundingClientRect();
		const left = Math.min(e.clientX - box.left + 14, box.width - 180);
		this.tip.style.left = `${Math.max(4, left)}px`;
		this.tip.style.top = `${Math.max(4, e.clientY - box.top - 40)}px`;
		this.tip.style.display = "";
	}

	private hide() {
		this.host.el.classList.remove("has-blame");
		this.svg.style.display = "none";
		this.legend.style.display = "none";
		this.tip.style.display = "none";
		for (const g of this.groups.values()) g.remove();
		this.groups.clear();
		this.paths.clear();
		this.focused = null;
	}

	destroy() {
		cancelAnimationFrame(this.hoverFrame);
		this.host.el.removeEventListener("pointermove", this.onMove);
		this.host.el.removeEventListener("pointerleave", this.onLeave);
		this.svg.remove();
		this.legend.remove();
		this.tip.remove();
	}
}

/** „jetzt“, „vor 5 Min.“, „vor 3 Std.“, „gestern“, „vor 4 Tagen“, sonst Datum. */
export function relativeTime(ts: number, now = Date.now()): string {
	const s = Math.max(0, (now - ts) / 1000);
	if (s < 60) return "jetzt";
	if (s < 3600) return `vor ${Math.floor(s / 60)} Min.`;
	if (s < 86400) return `vor ${Math.floor(s / 3600)} Std.`;
	const days = Math.floor(s / 86400);
	if (days === 1) return "gestern";
	if (days < 7) return `vor ${days} Tagen`;
	return new Date(ts).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" });
}

function formatTime(ts: number): string {
	return new Date(ts).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
