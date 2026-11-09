import type { InkColor, InkData, Stroke } from "../model/ink-format";
import { strokeBounds, type Bounds } from "../model/ops";
import type { Pattern } from "../model/pattern";
import type { LiveStroke as ApiLiveStroke, PointerPos, RemoteLabel } from "../api";
import { HL_ALPHA, outlineSvg, resolveColor, strokePath, strokeSvg, TAPE_REVEALED_ALPHA } from "./strokes";
import { strokeDiff, StrokeIndex } from "./strokeIndex";
import { scaleFor, tileLayout, type Tile } from "./transform";

interface TileState {
	tile: Tile;
	canvas: HTMLCanvasElement;
	ctx: CanvasRenderingContext2D | null;
	visible: boolean;
}

/** Der gerade entstehende Strich (Path2D und Bounds in Doc-Einheiten). */
export interface LiveStroke {
	path: Path2D;
	bounds: Bounds;
	color: InkColor;
	highlighter: boolean;
	/** Abdeckband: SVG-Pfad – landet in der Band-Ebene statt auf den Kacheln. */
	tape?: string;
	/**
	 * Bereich (Doc-Einheiten), in dem sich der Strich seit dem letzten `drawLive` geändert hat (siehe
	 * `outlineChange`). Ohne Angabe wird der ganze Strich neu gemalt.
	 */
	dirty?: Bounds;
}

/** Mehr Teilbereiche je Kachel werden zu einem zusammengefasst (jeder kostet eine Abfrage + Clip). */
const MAX_REGIONS = 12;

/** Lage der Fläche: Außenkante (`left`/`top`) und Innenkante ohne Rahmen (`x`/`y`), Clientkoordinaten. */
export interface ScreenRect {
	left: number;
	top: number;
	x: number;
	y: number;
}

const SVG_NS = "http://www.w3.org/2000/svg";
let tapeIds = 0;

/**
 * Zeichenfläche eines Blocks:
 *  - Hintergrundmuster per CSS,
 *  - fertige Striche in Kacheln (je TILE_HEIGHT CSS-px, Backing-Store nur solange sichtbar),
 *  - der gerade entstehende Strich direkt auf denselben Kacheln (nur der betroffene Ausschnitt wird neu gemalt).
 *    Ein eigener Live-Canvas, der pro Strich ein- und umgeschaltet wird, erschien unter Linux/Wayland mit
 *    Stift erst nach dem Absetzen.
 */
export class Surface {
	readonly el: HTMLElement;
	/** Ebene für den Arbeitsblatt-Hintergrund (PDF-Seite/Bild), unter den Strichen. */
	readonly bgEl: HTMLElement;
	/** Wird nach jedem Layout mit Breite (CSS-px) und DPR aufgerufen. */
	onLayout: ((cssWidth: number, dpr: number) => void) | null = null;
	private overlay: HTMLElement | null = null;
	private readonly tilesEl: HTMLElement;
	/** Zuletzt live gemalter Bereich – wird beim nächsten Frame bzw. Abbruch wieder sauber übermalt. */
	private liveBounds: Bounds | null = null;
	/** Der gerade entstehende Strich – wird bei jedem Neuzeichnen einer Kachel mitgemalt. */
	private live: LiveStroke | null = null;
	private tiles: TileState[] = [];
	/** Räumlicher Index der Striche – Neuzeichnen eines Bereichs fragt nur die Striche in seiner Nähe ab. */
	private readonly index = new StrokeIndex();
	/** Strichliste, die die sichtbaren Kacheln zeigen (Stand des letzten Neumalens) – Basis für `strokeDiff`. */
	private painted: readonly Stroke[] = [];
	/** Zuletzt in die Band-Ebene gezeichnete Bänder (überspringt den Neuaufbau, wenn sich nichts geändert hat). */
	private tapeState: { strokes: Stroke[]; hidden: Set<string>; revealed: number } | null = null;
	/** Angehobene Striche (Lasso-Auswahl) – die Auswahl-Ebene zeigt sie, die Kacheln nicht. */
	private hidden = new Set<string>();
	/** Aufgedeckte Abdeckbänder (gehört dem Store-Eintrag, alle Ansichten teilen ihn). */
	revealed: ReadonlySet<string> = new Set();
	/**
	 * Abdeckbänder liegen in einer eigenen SVG-Ebene über den Kacheln: Auf Arbeitsblättern werden die
	 * Kacheln multipliziert – ein Band dort würde gedruckten Text nicht verdecken.
	 */
	private readonly tapeSvg: SVGSVGElement;
	private readonly tapeGroup: SVGGElement;
	private readonly tapeLive: SVGGElement;
	/** Fremde, gerade entstehende Striche (Zusammenarbeit, siehe api.ts). */
	private readonly remoteGroup: SVGGElement;
	private remoteGhosts: { key: string; stroke: ApiLiveStroke; label: RemoteLabel }[] = [];
	private readonly outlineCache = new Map<string, { sig: string; d: string }>();
	private remotePointers: { key: string; pos: PointerPos; label: RemoteLabel }[] = [];
	private readonly stripesId = `ink-tape-stripes-${++tapeIds}`;
	private scale = 1;
	private cssWidth = 0;
	/** Breite/Modus des Dokuments beim letzten Layout (siehe `setDoc`). */
	private laidOut = "";
	private dpr = window.devicePixelRatio || 1;
	private inkColor = "";
	private readonly io: IntersectionObserver;
	private readonly ro: ResizeObserver;
	private resizeFrame = 0;

	constructor(
		parent: HTMLElement,
		private doc: InkData,
		private pattern: Pattern,
	) {
		this.el = parent.createDiv({ cls: "ink-surface" });
		this.bgEl = this.el.createDiv({ cls: "ink-bg" });
		this.tilesEl = this.el.createDiv({ cls: "ink-tiles" });
		this.tapeSvg = this.el.appendChild(document.createElementNS(SVG_NS, "svg"));
		this.tapeSvg.classList.add("ink-tape-layer");
		this.tapeSvg.setAttribute("preserveAspectRatio", "none");
		this.tapeSvg.innerHTML =
			`<defs><pattern id="${this.stripesId}" width="14" height="14" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">` +
			`<rect width="5" height="14" fill="#fff" fill-opacity="0.22"/></pattern></defs>`;
		this.tapeGroup = this.tapeSvg.appendChild(document.createElementNS(SVG_NS, "g"));
		this.tapeLive = this.tapeSvg.appendChild(document.createElementNS(SVG_NS, "g"));
		this.remoteGroup = this.tapeSvg.appendChild(document.createElementNS(SVG_NS, "g"));
		this.remoteGroup.classList.add("ink-remote-layer");

		this.io = new IntersectionObserver((entries) => this.onIntersect(entries), { rootMargin: "600px 0px" });
		this.ro = new ResizeObserver(() => {
			cancelAnimationFrame(this.resizeFrame);
			this.resizeFrame = requestAnimationFrame(() => this.layout());
		});
		this.ro.observe(this.el);
		this.updateSize();
	}

	get docScale() {
		return this.scale;
	}

	get data(): InkData {
		return this.doc;
	}

	/** Striche aus den Kacheln nehmen bzw. zurückholen (nur die betroffenen Bereiche werden neu gemalt). */
	setHidden(ids: Set<string>) {
		const changed = this.doc.strokes.filter((s) => ids.has(s.id) !== this.hidden.has(s.id));
		this.hidden = new Set(ids);
		if (changed.length) this.redraw(changed.map(strokeBounds));
	}

	destroy() {
		cancelAnimationFrame(this.resizeFrame);
		this.io.disconnect();
		this.ro.disconnect();
		this.el.remove();
	}

	/**
	 * Dokument neu geladen (Sync, Zusammenarbeit) oder in einer anderen Ansicht geändert. Gleiche Geometrie:
	 * Kacheln bleiben stehen, nur hinzugekommene/entfernte Striche werden neu gemalt (ein gerade entstehender
	 * eigener Strich bleibt sichtbar). Sonst wie bisher: Kacheln neu anlegen.
	 */
	setDoc(doc: InkData) {
		this.doc = doc;
		this.updateSize();
		// Vergleich mit dem Stand beim letzten Layout – das Dokument kann auch an Ort und Stelle geändert sein
		// (Heft → Arbeitsblatt).
		if (geometryKey(doc) !== this.laidOut || !this.cssWidth) {
			// Alle Kacheln neu (leer, bis sichtbar) – sie zeigen danach den aktuellen Stand.
			this.painted = doc.strokes.slice();
			this.layout(true);
			return;
		}
		this.layout();
		this.repaintChanges([]);
	}

	setPattern(pattern: Pattern) {
		this.pattern = pattern;
		this.applyPattern();
	}

	/**
	 * Lage der Fläche auf dem Bildschirm (ein Layout-Zugriff). Ein Pointer-Event samt seiner gebündelten
	 * (coalesced) Events rechnet mit einer Messung, statt pro Punkt neu zu messen (siehe `toDocAt`).
	 */
	measure(): ScreenRect {
		const r = this.el.getBoundingClientRect();
		return { left: r.left, top: r.top, x: r.left + this.el.clientLeft, y: r.top + this.el.clientTop };
	}

	/** Lage der Innenkante auf dem Bildschirm (Clientkoordinaten) – ändert sie sich, ist die Fläche verrutscht. */
	screenOrigin(): { x: number; y: number } {
		return this.measure();
	}

	/** Clientkoordinaten → Doc-Einheiten (relativ zur Innenkante, ohne Rahmen). */
	toDoc(clientX: number, clientY: number): { x: number; y: number } {
		return this.toDocAt(this.measure(), clientX, clientY);
	}

	/** Wie `toDoc`, mit einer vorhandenen Messung. */
	toDocAt(o: ScreenRect, clientX: number, clientY: number): { x: number; y: number } {
		return { x: (clientX - o.x) / this.scale, y: (clientY - o.y) / this.scale };
	}

	/** Hinweis über der Fläche (z. B. fehlender Hintergrund); `null` entfernt ihn. */
	showOverlay(message: string | null) {
		this.overlay?.remove();
		this.overlay = message ? this.el.createDiv({ cls: "ink-overlay", text: message }) : null;
	}

	private updateSize() {
		const { space, w, h, strokes } = this.doc;
		const ds = this.el.dataset;
		if (ds.space !== space) {
			ds.space = space;
			// Farbe der fremden Striche hängt am Modus (Tinte im Heft vs. schwarz auf dem Arbeitsblatt)
			this.renderRemote();
		}
		const aspect = `${w} / ${h}`;
		if (this.el.style.aspectRatio !== aspect) this.el.style.aspectRatio = aspect;
		ds.strokes = String(strokes.length);
		const viewBox = `0 0 ${w} ${h}`;
		if (this.tapeSvg.getAttribute("viewBox") !== viewBox) this.tapeSvg.setAttribute("viewBox", viewBox);
		this.syncTape();
	}

	/** Fremde, gerade entstehende Striche halbtransparent mit Namensschild zeigen. */
	drawRemote(ghosts: { key: string; stroke: ApiLiveStroke; label: RemoteLabel }[], pointers: { key: string; pos: PointerPos; label: RemoteLabel }[] = []) {
		this.remoteGhosts = ghosts;
		this.remotePointers = pointers;
		this.renderRemote();
	}

	private renderRemote() {
		const nodes: SVGElement[] = [];
		// Schrift in CSS-px, unabhängig vom Zoom der Fläche
		const fs = 11 / (this.scale || 1);
		const withPointer = new Set(this.remotePointers.map((p) => p.key));
		for (const { key, stroke, label } of this.remoteGhosts) {
			const p = stroke.points;
			if (p.length < 3) continue;
			const g = document.createElementNS(SVG_NS, "g");
			g.dataset.key = key;
			g.dataset.stroke = stroke.id;
			g.classList.add("ink-remote-stroke");
			const d = this.remoteOutline(key, stroke);
			if (d) {
				const path = g.appendChild(document.createElementNS(SVG_NS, "path"));
				path.setAttribute("d", d);
				path.setAttribute("fill", resolveColor(stroke.color, this.doc.space, this.el));
				path.setAttribute("fill-opacity", stroke.tool === "hl" ? String(HL_ALPHA * 0.7) : "0.55");
			}
			// Namensschild sitzt am Zeiger, falls es einen gibt
			if (label.name && !withPointer.has(key)) {
				const x = p[p.length - 3];
				const y = p[p.length - 2];
				const text = g.appendChild(document.createElementNS(SVG_NS, "text"));
				text.textContent = label.name;
				text.setAttribute("x", String(x + fs * 0.6));
				text.setAttribute("y", String(y - fs * 0.6));
				text.setAttribute("font-size", String(fs));
				text.setAttribute("fill", "#fff");
				text.setAttribute("paint-order", "stroke");
				text.setAttribute("stroke", label.color);
				text.setAttribute("stroke-width", String(fs * 0.5));
				text.setAttribute("stroke-linejoin", "round");
			}
			nodes.push(g);
		}
		this.el.dataset.remote = String(nodes.length);
		// Fremde Stift-/Mauszeiger: Punkt in der Farbe der Person (Stift: Ring = schwebt, gefüllt = schreibt) + Name
		for (const { key, pos, label } of this.remotePointers) {
			const g = document.createElementNS(SVG_NS, "g");
			g.dataset.key = key;
			g.classList.add("ink-remote-pointer");
			const r = (pos.kind === "pen" ? 4 : 5) / (this.scale || 1);
			const c = g.appendChild(document.createElementNS(SVG_NS, "circle"));
			c.setAttribute("cx", String(pos.x));
			c.setAttribute("cy", String(pos.y));
			c.setAttribute("r", String(r));
			c.setAttribute("fill", pos.down || pos.kind !== "pen" ? label.color : "none");
			c.setAttribute("fill-opacity", "0.85");
			c.setAttribute("stroke", label.color);
			c.setAttribute("stroke-width", String(1.5 / (this.scale || 1)));
			if (label.name) {
				const text = g.appendChild(document.createElementNS(SVG_NS, "text"));
				text.textContent = label.name;
				text.setAttribute("x", String(pos.x + r * 1.6));
				text.setAttribute("y", String(pos.y - r * 1.6));
				text.setAttribute("font-size", String(fs));
				text.setAttribute("fill", "#fff");
				text.setAttribute("paint-order", "stroke");
				text.setAttribute("stroke", label.color);
				text.setAttribute("stroke-width", String(fs * 0.5));
				text.setAttribute("stroke-linejoin", "round");
			}
			nodes.push(g);
		}
		this.remoteGroup.replaceChildren(...nodes);
		this.el.dataset.pointers = String(this.remotePointers.length);
		// Umrisse nicht mehr gezeigter Geister vergessen
		if (this.outlineCache.size > this.remoteGhosts.length) {
			const keys = new Set(this.remoteGhosts.map((g) => g.key));
			for (const k of this.outlineCache.keys()) if (!keys.has(k)) this.outlineCache.delete(k);
		}
	}

	/**
	 * Umriss eines fremden Strichs – gemerkt, solange er sich nicht ändert: Neu gezeichnet wird bei jeder
	 * Nachricht (auch nur Zeigerbewegungen anderer), neu berechnet nur der Strich, der gewachsen ist.
	 */
	private remoteOutline(key: string, s: ApiLiveStroke): string {
		const p = s.points;
		const sig = `${s.id}|${s.tool}|${s.size}|${s.simulated ? 1 : 0}|${p.length}|${p[p.length - 3]}|${p[p.length - 2]}|${p[p.length - 1]}`;
		const hit = this.outlineCache.get(key);
		if (hit?.sig === sig) return hit.d;
		const d = outlineSvg(p, s, false);
		this.outlineCache.set(key, { sig, d });
		return d;
	}

	/** Band-Ebene neu aufbauen (wenige Elemente – billiger als Buchführung über Änderungen). */
	renderTape() {
		const tapes = this.doc.strokes.filter((s) => s.tool === "tape" && !this.hidden.has(s.id));
		this.tapeGroup.replaceChildren(...tapes.map((s) => this.tapeElement(strokeSvg(s), s.color, this.revealed.has(s.id), s.id)));
		this.el.dataset.tapes = String(tapes.length);
		this.tapeState = { strokes: tapes, hidden: this.hidden, revealed: this.revealedKey() };
	}

	/** Band-Ebene nur neu aufbauen, wenn sich Bänder, Auswahl oder Aufdecken geändert haben. */
	private syncTape() {
		const st = this.tapeState;
		if (st && st.hidden === this.hidden && st.revealed === this.revealedKey()) {
			let i = 0;
			let same = true;
			for (const s of this.doc.strokes) {
				if (s.tool !== "tape" || this.hidden.has(s.id)) continue;
				if (st.strokes[i++] !== s) {
					same = false;
					break;
				}
			}
			if (same && i === st.strokes.length) return;
		}
		this.renderTape();
	}

	/** Grober Schlüssel für den Aufdeck-Zustand (Größe + Inhalt), damit `syncTape` Änderungen bemerkt. */
	private revealedKey(): number {
		let k = this.revealed.size;
		for (const id of this.revealed) for (let i = 0; i < id.length; i++) k = (k * 31 + id.charCodeAt(i)) | 0;
		return k;
	}

	private tapeElement(d: string, color: InkColor, revealed: boolean, id?: string): SVGGElement {
		const g = document.createElementNS(SVG_NS, "g");
		g.classList.add("ink-tape");
		if (id) g.dataset.id = id;
		if (revealed) {
			g.classList.add("is-revealed");
			g.setAttribute("opacity", String(TAPE_REVEALED_ALPHA));
		}
		const fill = g.appendChild(document.createElementNS(SVG_NS, "path"));
		fill.setAttribute("d", d);
		fill.setAttribute("fill", this.color(color));
		const stripes = g.appendChild(document.createElementNS(SVG_NS, "path"));
		stripes.setAttribute("d", d);
		stripes.setAttribute("fill", `url(#${this.stripesId})`);
		return g;
	}

	/** Neu-Layout bei Größenänderung. Bei gleicher Breite bleiben unveränderte Kacheln erhalten (Wachsen). */
	layout(force = false) {
		const width = this.el.clientWidth;
		const dpr = window.devicePixelRatio || 1;
		if (!width) return;
		const key = geometryKey(this.doc);
		const sameGeometry = !force && width === this.cssWidth && dpr === this.dpr && key === this.laidOut;
		this.cssWidth = width;
		this.dpr = dpr;
		this.scale = scaleFor(this.doc.w, width);
		this.laidOut = key;
		this.applyPattern();
		if (!sameGeometry && (this.remoteGhosts.length || this.remotePointers.length)) this.renderRemote();
		this.onLayout?.(width, dpr);

		const wanted = tileLayout(this.doc.h * this.scale);
		let keep = 0;
		if (sameGeometry) {
			while (
				keep < this.tiles.length &&
				keep < wanted.length &&
				this.tiles[keep].tile.top === wanted[keep].top &&
				this.tiles[keep].tile.height === wanted[keep].height
			) {
				keep++;
			}
			if (keep === this.tiles.length && keep === wanted.length) return;
			// Wachsen/Schrumpfen: die letzte Kachel an Ort und Stelle anpassen und sofort neu malen.
			// Neu anlegen hieße: leer, bis der IntersectionObserver meldet – die Tinte blinkte weg.
			const t = this.tiles[keep];
			if (t && keep < wanted.length && t.tile.top === wanted[keep].top) {
				t.tile = wanted[keep];
				t.canvas.style.height = `${t.tile.height}px`;
				if (t.visible) this.drawTile(t);
				keep++;
			}
		}
		for (const t of this.tiles.splice(keep)) {
			this.io.unobserve(t.canvas);
			t.canvas.remove();
		}
		for (const tile of wanted.slice(keep)) {
			const canvas = this.tilesEl.createEl("canvas", { cls: "ink-tile" });
			canvas.style.top = `${tile.top}px`;
			canvas.style.height = `${tile.height}px`;
			const t: TileState = { tile, canvas, ctx: canvas.getContext("2d"), visible: false };
			this.tiles.push(t);
			this.io.observe(canvas);
			// Beim Wachsen während eines Strichs liegt die neue Kachel direkt unter dem Stift: gleich malen.
			if (sameGeometry && this.live) {
				t.visible = true;
				this.drawTile(t);
			}
		}
	}

	/** Höhe des Dokuments hat sich geändert (Wachsen oder Undo). */
	resize() {
		this.updateSize();
		this.layout();
	}

	redrawAll() {
		this.inkColor = "";
		this.tapeState = null; // Farben neu auflösen
		this.updateSize();
		this.repaintAll();
	}

	private repaintAll() {
		this.painted = this.doc.strokes.slice();
		for (const t of this.tiles) if (t.visible) this.drawTile(t);
	}

	/**
	 * Alles neu malen, was sich seit dem letzten Neumalen geändert hat (Striche hinzugekommen/entfernt),
	 * plus `extra`. So bleiben die Kacheln richtig, auch wenn eine andere Ansicht dasselbe Dokument geändert hat.
	 */
	private repaintChanges(extra: Bounds[]) {
		const diff = strokeDiff(this.painted, this.doc.strokes);
		if (diff === null) return this.repaintAll();
		this.painted = this.doc.strokes.slice();
		this.repaint(diff.length ? extra.concat(diff) : extra);
	}

	/** Nach einer Änderung am Dokument: nur die betroffenen Bereiche neu malen (beendet einen Live-Strich). */
	redraw(bounds: Bounds[]) {
		this.tapeLive.replaceChildren();
		this.updateSize();
		// Reste eines Live-Strichs (dessen Umriss weicht leicht vom fertigen ab) mit übermalen.
		if (this.liveBounds) {
			bounds = [...bounds, pad(this.liveBounds)];
			this.liveBounds = null;
		}
		this.live = null;
		this.repaintChanges(bounds);
	}

	/**
	 * Bereiche (Doc-Einheiten) auf allen sichtbaren Kacheln neu malen – jeweils nur den Ausschnitt, nicht die
	 * ganze Kachel. Ergebnis wie beim Neumalen der ganzen Kachel, bis auf Antialiasing-Rauschen an einzelnen
	 * Kantenpixeln (Skia rastert innerhalb eines Clips minimal anders, siehe E2E m30-render-regions).
	 */
	private repaint(bounds: Bounds[]) {
		if (!bounds.length) return;
		const { scale } = this;
		for (const t of this.tiles) {
			if (!t.visible || !t.canvas.width) continue;
			const top = t.tile.top / scale;
			const bottom = (t.tile.top + t.tile.height) / scale;
			let regions = mergeOverlapping(bounds.filter((b) => b.maxY >= top && b.minY <= bottom));
			if (!regions.length) continue;
			if (regions.length > MAX_REGIONS) regions = [regions.reduce(union)];
			for (const r of regions) this.paint(t, r, this.live ?? undefined);
		}
	}

	private onIntersect(entries: IntersectionObserverEntry[]) {
		for (const entry of entries) {
			const t = this.tiles.find((s) => s.canvas === entry.target);
			if (!t) continue;
			t.visible = entry.isIntersecting;
			if (t.visible) this.drawTile(t);
			else t.canvas.width = t.canvas.height = 0; // Speicher freigeben
		}
	}

	color(index: InkColor): string {
		if (index !== 0) return resolveColor(index, this.doc.space, this.el);
		if (!this.inkColor) this.inkColor = resolveColor(0, this.doc.space, this.el);
		return this.inkColor;
	}

	private drawTile(t: TileState) {
		const { dpr } = this;
		const w = Math.round(this.cssWidth * dpr);
		const h = Math.round(t.tile.height * dpr);
		// Gleiche Größe: nur leeren statt den Speicher neu anzulegen.
		if (t.canvas.width !== w || t.canvas.height !== h) {
			t.canvas.width = w;
			t.canvas.height = h;
		} else if (t.ctx) {
			t.ctx.setTransform(1, 0, 0, 1, 0, 0);
			t.ctx.clearRect(0, 0, w, h);
		}
		if (t.ctx) this.paint(t, null, this.live ?? undefined);
	}

	/**
	 * Malt eine Kachel neu – ganz (`region` = null, Canvas frisch geleert) oder nur einen Ausschnitt
	 * (Doc-Einheiten). Reihenfolge: Textmarker, Live-Textmarker, Stift, Live-Stift – Markierungen liegen
	 * damit auch während des Zeichnens unter der Schrift.
	 *
	 * Der Ausschnitt wird auf ganze Geräte-Pixel erweitert: Clip und Löschen decken Pixel dann ganz oder gar
	 * nicht ab (keine halb gelöschten Kantenpixel), und darin werden alle Striche gemalt, deren Bounds ihn
	 * berühren – dieselben Pfade in derselben Reihenfolge wie beim Neumalen der ganzen Kachel.
	 */
	private paint({ tile, ctx, canvas }: TileState, region: Bounds | null, live?: LiveStroke) {
		if (!ctx) return;
		const { dpr, scale } = this;
		const k = dpr * scale;
		const offY = tile.top * dpr;
		let top = tile.top / scale;
		let bottom = (tile.top + tile.height) / scale;
		let left = -Infinity;
		let right = Infinity;
		if (region) {
			const x0 = Math.max(0, Math.floor(region.minX * k));
			const x1 = Math.min(canvas.width, Math.ceil(region.maxX * k));
			const y0 = Math.max(0, Math.floor(region.minY * k - offY));
			const y1 = Math.min(canvas.height, Math.ceil(region.maxY * k - offY));
			if (!(x1 > x0 && y1 > y0)) return;
			ctx.save();
			ctx.setTransform(1, 0, 0, 1, 0, 0);
			ctx.beginPath();
			ctx.rect(x0, y0, x1 - x0, y1 - y0);
			ctx.clip();
			ctx.clearRect(x0, y0, x1 - x0, y1 - y0);
			// Abfrage über den erweiterten Ausschnitt (Doc-Einheiten)
			left = x0 / k;
			right = x1 / k;
			top = Math.max(top, (y0 + offY) / k);
			bottom = Math.min(bottom, (y1 + offY) / k);
		}
		ctx.setTransform(k, 0, 0, k, 0, -offY);
		this.index.sync(this.doc.strokes);
		const inRegion = this.index.query(top, bottom, left, right).filter((s) => s.tool !== "tape" && !this.hidden.has(s.id));
		ctx.globalAlpha = HL_ALPHA;
		for (const s of inRegion) if (s.tool === "hl") this.fill(ctx, s.color, strokePath(s));
		if (live?.highlighter) this.fill(ctx, live.color, live.path);
		ctx.globalAlpha = 1;
		for (const s of inRegion) if (s.tool !== "hl") this.fill(ctx, s.color, strokePath(s));
		if (live && !live.highlighter) this.fill(ctx, live.color, live.path);
		if (region) ctx.restore();
	}

	private fill(ctx: CanvasRenderingContext2D, color: InkColor, path: Path2D) {
		ctx.fillStyle = this.color(color);
		ctx.fill(path);
	}

	private applyPattern() {
		const style = this.doc.space === "page" ? "blank" : this.pattern.style;
		this.el.dataset.bg = style;
		this.el.dataset.gap = String(this.pattern.gap);
		this.el.style.setProperty("--ink-gap", `${this.pattern.gap * this.scale}px`);
	}

	// ---- Live-Strich ----

	/** Strich während des Zeichnens auf die Kacheln malen (synchron, ohne eigenen Canvas). */
	drawLive(live: LiveStroke) {
		if (live.tape !== undefined) {
			this.tapeLive.replaceChildren(this.tapeElement(live.tape, live.color, false));
			return;
		}
		// Nur das geänderte Ende neu malen – sofern der bisherige Live-Strich noch auf den Kacheln steht.
		const partial = this.live !== null && live.dirty !== undefined;
		const dirty = partial ? live.dirty! : this.liveBounds ? union(this.liveBounds, live.bounds) : live.bounds;
		this.liveBounds = live.bounds;
		this.live = live;
		if (dirty.maxX < dirty.minX) return; // Umriss unverändert
		this.paintLive(pad(dirty), live);
	}

	/** Live-Strich wieder entfernen (Abbruch). Nach dem Absetzen übermalt `redraw` den Bereich ohnehin. */
	clearLive() {
		this.tapeLive.replaceChildren();
		this.live = null;
		if (!this.liveBounds) return;
		const dirty = this.liveBounds;
		this.liveBounds = null;
		this.paintLive(pad(dirty));
	}

	private paintLive(region: Bounds, live?: LiveStroke) {
		const top = region.minY * this.scale;
		const bottom = region.maxY * this.scale;
		for (const t of this.tiles) {
			if (t.visible && t.canvas.width && bottom >= t.tile.top && top <= t.tile.top + t.tile.height) this.paint(t, region, live);
		}
	}
}

/**
 * Sich überlappende Bereiche zusammenfassen – sonst würden Striche im Überlapp zweimal gemalt (z. B. Strich
 * und Rest des Live-Strichs beim Absetzen, die fast deckungsgleich sind).
 */
function mergeOverlapping(list: Bounds[]): Bounds[] {
	const out: Bounds[] = [];
	for (let b of list) {
		for (let i = 0; i < out.length; ) {
			const o = out[i];
			if (o.maxX >= b.minX && o.minX <= b.maxX && o.maxY >= b.minY && o.minY <= b.maxY) {
				b = union(o, b);
				out.splice(i, 1);
				i = 0; // vergrößert: wieder von vorn prüfen
			} else i++;
		}
		out.push(b);
	}
	return out;
}

function geometryKey(doc: InkData): string {
	return `${doc.space}|${doc.w}|${doc.bg?.kind ?? ""}|${doc.bg?.page ?? ""}`;
}

function union(a: Bounds, b: Bounds): Bounds {
	return {
		minX: Math.min(a.minX, b.minX),
		minY: Math.min(a.minY, b.minY),
		maxX: Math.max(a.maxX, b.maxX),
		maxY: Math.max(a.maxY, b.maxY),
	};
}

/** Etwas Rand gegen Kantenreste durch Antialiasing. */
function pad(b: Bounds, by = 2): Bounds {
	return { minX: b.minX - by, minY: b.minY - by, maxX: b.maxX + by, maxY: b.maxY + by };
}
