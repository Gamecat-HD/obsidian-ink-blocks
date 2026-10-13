import type { InkData } from "../model/ink-format";
import { strokeBounds, type Bounds } from "../model/ops";
import type { Pattern } from "../model/pattern";
import { HL_ALPHA, resolveColor, strokePath } from "./strokes";
import { scaleFor, tileLayout, tilesForBounds, type Tile } from "./transform";

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
	color: number;
	highlighter: boolean;
}

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
		private pattern: Pattern,
	) {
		this.el = parent.createDiv({ cls: "ink-surface" });
		this.bgEl = this.el.createDiv({ cls: "ink-bg" });
		this.tilesEl = this.el.createDiv({ cls: "ink-tiles" });

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

	setPattern(pattern: Pattern) {
		this.pattern = pattern;
		this.applyPattern();
	}

	/** Clientkoordinaten → Doc-Einheiten (relativ zur Innenkante, ohne Rahmen). */
	toDoc(clientX: number, clientY: number): { x: number; y: number } {
		const r = this.el.getBoundingClientRect();
		return {
			x: (clientX - r.left - this.el.clientLeft) / this.scale,
			y: (clientY - r.top - this.el.clientTop) / this.scale,
		};
	}

	/** Hinweis über der Fläche (z. B. fehlender Hintergrund); `null` entfernt ihn. */
	showOverlay(message: string | null) {
		this.overlay?.remove();
		this.overlay = message ? this.el.createDiv({ cls: "ink-overlay", text: message }) : null;
	}

	private updateSize() {
		this.el.dataset.space = this.doc.space;
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
		this.updateSize();
		this.inkColor = "";
		for (const t of this.tiles) if (t.visible) this.drawTile(t);
	}

	redraw(bounds: Bounds[]) {
		this.updateSize();
		// Reste eines Live-Strichs (dessen Umriss weicht leicht vom fertigen ab) mit übermalen.
		if (this.liveBounds) {
			bounds = [...bounds, pad(this.liveBounds)];
			this.liveBounds = null;
		}
		this.live = null;
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

	private drawTile(t: TileState) {
		const { dpr } = this;
		t.canvas.width = Math.round(this.cssWidth * dpr);
		t.canvas.height = Math.round(t.tile.height * dpr);
		if (t.ctx) this.paint(t, null, this.live ?? undefined);
	}

	/**
	 * Malt eine Kachel neu – ganz (`region` = null, Canvas frisch geleert) oder nur einen Ausschnitt
	 * (Doc-Einheiten). Reihenfolge: Textmarker, Live-Textmarker, Stift, Live-Stift – Markierungen liegen
	 * damit auch während des Zeichnens unter der Schrift.
	 */
	private paint({ tile, ctx }: TileState, region: Bounds | null, live?: LiveStroke) {
		if (!ctx) return;
		const { dpr, scale } = this;
		ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, -tile.top * dpr);
		let top = tile.top / scale;
		let bottom = (tile.top + tile.height) / scale;
		if (region) {
			ctx.save();
			const w = region.maxX - region.minX;
			const h = region.maxY - region.minY;
			ctx.beginPath();
			ctx.rect(region.minX, region.minY, w, h);
			ctx.clip();
			ctx.clearRect(region.minX, region.minY, w, h);
			top = Math.max(top, region.minY);
			bottom = Math.min(bottom, region.maxY);
		}
		const inRegion = this.doc.strokes.filter((s) => {
			const b = strokeBounds(s);
			if (b.maxY < top || b.minY > bottom) return false;
			return !region || (b.maxX >= region.minX && b.minX <= region.maxX);
		});
		ctx.globalAlpha = HL_ALPHA;
		for (const s of inRegion) if (s.tool === "hl") this.fill(ctx, s.color, strokePath(s));
		if (live?.highlighter) this.fill(ctx, live.color, live.path);
		ctx.globalAlpha = 1;
		for (const s of inRegion) if (s.tool !== "hl") this.fill(ctx, s.color, strokePath(s));
		if (live && !live.highlighter) this.fill(ctx, live.color, live.path);
		if (region) ctx.restore();
	}

	private fill(ctx: CanvasRenderingContext2D, color: number, path: Path2D) {
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
		const dirty = this.liveBounds ? union(this.liveBounds, live.bounds) : live.bounds;
		this.liveBounds = live.bounds;
		this.live = live;
		this.paintLive(pad(dirty), live);
	}

	/** Live-Strich wieder entfernen (Abbruch). Nach dem Absetzen übermalt `redraw` den Bereich ohnehin. */
	clearLive() {
		this.live = null;
		if (!this.liveBounds) return;
		const dirty = this.liveBounds;
		this.liveBounds = null;
		this.paintLive(pad(dirty));
	}

	private paintLive(region: Bounds, live?: LiveStroke) {
		for (const i of tilesForBounds(region, this.scale, this.tiles.map((t) => t.tile))) {
			const t = this.tiles[i];
			if (t?.visible && t.canvas.width) this.paint(t, region, live);
		}
	}
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
