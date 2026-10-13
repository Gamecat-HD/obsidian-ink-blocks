import type { InkData } from "../model/ink-format";
import { strokeBounds, type Bounds } from "../model/ops";
import type { BgStyle } from "../settings";
import { HL_ALPHA, resolveColor, strokePath } from "./strokes";
import { scaleFor, tileLayout, tilesForBounds, type Tile } from "./transform";

/** Linienabstand liniert/kariert in Doc-Einheiten. */
const RULED_GAP = 40;
const GRID_GAP = 25;

interface TileState {
	tile: Tile;
	canvas: HTMLCanvasElement;
	visible: boolean;
}

/**
 * Zeichenfläche eines Blocks:
 *  - Hintergrundmuster per CSS,
 *  - fertige Striche in Kacheln (je TILE_HEIGHT CSS-px, Backing-Store nur solange sichtbar),
 *  - der gerade entstehende Strich auf einem eigenen Live-Canvas über dem sichtbaren Ausschnitt.
 */
export class Surface {
	readonly el: HTMLElement;
	private readonly tilesEl: HTMLElement;
	private readonly live: HTMLCanvasElement;
	private readonly liveCtx: CanvasRenderingContext2D;
	private liveTop = 0;
	private tiles: TileState[] = [];
	private scale = 1;
	private cssWidth = 0;
	private dpr = window.devicePixelRatio || 1;
	private inkColor = "";
	private readonly io: IntersectionObserver;
	private readonly ro: ResizeObserver;
	private resizeFrame = 0;

	constructor(
		parent: HTMLElement,
		private doc: InkData,
		private bgStyle: BgStyle,
	) {
		this.el = parent.createDiv({ cls: "ink-surface" });
		this.tilesEl = this.el.createDiv({ cls: "ink-tiles" });
		this.live = this.el.createEl("canvas", { cls: "ink-live" });
		const ctx = this.live.getContext("2d", { desynchronized: true });
		if (!ctx) throw new Error("Canvas 2D nicht verfügbar");
		this.liveCtx = ctx;

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

	destroy() {
		cancelAnimationFrame(this.resizeFrame);
		this.io.disconnect();
		this.ro.disconnect();
		this.el.remove();
	}

	setDoc(doc: InkData) {
		this.doc = doc;
		this.updateSize();
		this.layout(true);
	}

	setBgStyle(style: BgStyle) {
		this.bgStyle = style;
		this.applyPattern();
	}

	/** Clientkoordinaten → Doc-Einheiten. */
	toDoc(clientX: number, clientY: number): { x: number; y: number } {
		const r = this.el.getBoundingClientRect();
		return { x: (clientX - r.left) / this.scale, y: (clientY - r.top) / this.scale };
	}

	private updateSize() {
		this.el.style.aspectRatio = `${this.doc.w} / ${this.doc.h}`;
		this.el.dataset.strokes = String(this.doc.strokes.length);
	}

	/** Neu-Layout bei Größenänderung. Bei gleicher Breite bleiben unveränderte Kacheln erhalten (Wachsen). */
	layout(force = false) {
		const width = this.el.clientWidth;
		const dpr = window.devicePixelRatio || 1;
		if (!width) return;
		const sameGeometry = !force && width === this.cssWidth && dpr === this.dpr;
		this.cssWidth = width;
		this.dpr = dpr;
		this.scale = scaleFor(this.doc.w, width);
		this.applyPattern();

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
		}
		for (const t of this.tiles.splice(keep)) {
			this.io.unobserve(t.canvas);
			t.canvas.remove();
		}
		for (const tile of wanted.slice(keep)) {
			const canvas = this.tilesEl.createEl("canvas", { cls: "ink-tile" });
			canvas.style.top = `${tile.top}px`;
			canvas.style.height = `${tile.height}px`;
			this.tiles.push({ tile, canvas, visible: false });
			this.io.observe(canvas);
		}
	}

	/** Höhe des Dokuments hat sich geändert (Wachsen oder Undo). */
	resize() {
		this.updateSize();
		this.layout();
	}

	redrawAll() {
		this.updateSize();
		this.inkColor = "";
		for (const t of this.tiles) if (t.visible) this.drawTile(t);
	}

	redraw(bounds: Bounds[]) {
		this.updateSize();
		const dirty = new Set<number>();
		for (const b of bounds) for (const i of tilesForBounds(b, this.scale, this.tiles.map((t) => t.tile))) dirty.add(i);
		for (const i of dirty) if (this.tiles[i]?.visible) this.drawTile(this.tiles[i]);
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

	private color(index: number): string {
		if (index !== 0) return resolveColor(index, this.doc.space, this.el);
		if (!this.inkColor) this.inkColor = resolveColor(0, this.doc.space, this.el);
		return this.inkColor;
	}

	private drawTile({ tile, canvas }: TileState) {
		const { dpr, scale } = this;
		canvas.width = Math.round(this.cssWidth * dpr);
		canvas.height = Math.round(tile.height * dpr);
		const ctx = canvas.getContext("2d");
		if (!ctx) return;
		ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, -tile.top * dpr);

		const top = tile.top / scale;
		const bottom = (tile.top + tile.height) / scale;
		const inTile = this.doc.strokes.filter((s) => {
			const b = strokeBounds(s);
			return b.maxY >= top && b.minY <= bottom;
		});
		// Textmarker unter die Schrift.
		ctx.globalAlpha = HL_ALPHA;
		for (const s of inTile) if (s.tool === "hl") this.fill(ctx, s.color, strokePath(s));
		ctx.globalAlpha = 1;
		for (const s of inTile) if (s.tool !== "hl") this.fill(ctx, s.color, strokePath(s));
	}

	private fill(ctx: CanvasRenderingContext2D, color: number, path: Path2D) {
		ctx.fillStyle = this.color(color);
		ctx.fill(path);
	}

	private applyPattern() {
		const style = this.doc.space === "page" ? "blank" : this.bgStyle;
		this.el.dataset.bg = style;
		const gap = (style === "grid" ? GRID_GAP : RULED_GAP) * this.scale;
		this.el.style.setProperty("--ink-gap", `${gap}px`);
	}

	// ---- Live-Strich ----

	/** Live-Canvas über den aktuell sichtbaren Teil der Fläche legen (während eines Strichs wird nicht gescrollt). */
	beginLive() {
		const r = this.el.getBoundingClientRect();
		const top = Math.max(0, -r.top);
		const bottom = Math.min(r.height, window.innerHeight - r.top);
		const height = Math.max(1, bottom - top);
		this.liveTop = top;
		this.live.style.top = `${top}px`;
		this.live.style.height = `${height}px`;
		this.live.width = Math.round(this.cssWidth * this.dpr);
		this.live.height = Math.round(height * this.dpr);
		this.live.style.display = "block";
	}

	drawLive(path: Path2D, color: number, highlighter: boolean) {
		const ctx = this.liveCtx;
		const { dpr, scale } = this;
		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.clearRect(0, 0, this.live.width, this.live.height);
		ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, -this.liveTop * dpr);
		ctx.globalAlpha = highlighter ? HL_ALPHA : 1;
		this.fill(ctx, color, path);
	}

	endLive() {
		this.liveCtx.setTransform(1, 0, 0, 1, 0, 0);
		this.liveCtx.clearRect(0, 0, this.live.width, this.live.height);
		this.live.style.display = "none";
	}
}
