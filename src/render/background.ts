import { loadPdfJs, Platform, type App, type TFile } from "obsidian";
import type { InkBackground } from "../model/ink-format";

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp", "gif", "bmp", "svg", "avif"]);
/** Nach einer Größenänderung erst so lange warten, bevor die PDF-Seite neu gerendert wird. */
const RERENDER_DELAY = 200;

export function backgroundKind(file: TFile): InkBackground["kind"] | null {
	const ext = file.extension.toLowerCase();
	if (ext === "pdf") return "pdf";
	return IMAGE_EXTENSIONS.has(ext) ? "image" : null;
}

/**
 * Kleiner LRU-Cache: Einfügen/Lesen setzt den Eintrag ans Ende. Begrenzt auf `size` Einträge und – mit
 * `weigh` – auf ein Gesamtgewicht (z. B. Bytes).
 */
class Lru<V> {
	private readonly map = new Map<string, V>();
	private total = 0;
	constructor(
		private readonly size: number,
		private readonly onEvict?: (v: V) => void,
		private readonly weigh: (v: V) => number = () => 0,
		private readonly budget = Infinity,
	) {}
	get(key: string): V | undefined {
		const v = this.map.get(key);
		if (v !== undefined) {
			this.map.delete(key);
			this.map.set(key, v);
		}
		return v;
	}
	set(key: string, v: V) {
		const prev = this.map.get(key);
		if (prev !== undefined) {
			this.map.delete(key);
			this.total -= this.weigh(prev);
			if (prev !== v) this.onEvict?.(prev);
		}
		this.map.set(key, v);
		this.total += this.weigh(v);
		// Der neueste Eintrag bleibt immer (auch wenn er allein das Budget sprengt).
		while (this.map.size > 1 && (this.map.size > this.size || this.total > this.budget)) {
			const [k, old] = this.map.entries().next().value as [string, V];
			this.map.delete(k);
			this.total -= this.weigh(old);
			this.onEvict?.(old);
		}
	}
	clear() {
		for (const v of this.map.values()) this.onEvict?.(v);
		this.map.clear();
		this.total = 0;
	}
}

// pdf.js-Typen sind über loadPdfJs nicht exportiert – nur das Nötigste.
interface PdfViewport {
	width: number;
	height: number;
}
interface PdfPage {
	getViewport(o: { scale: number }): PdfViewport;
	render(o: { canvasContext: CanvasRenderingContext2D; viewport: PdfViewport }): { promise: Promise<void>; cancel(): void };
	cleanup(): void;
}
interface PdfDoc {
	numPages: number;
	getPage(n: number): Promise<PdfPage>;
	destroy(): Promise<void>;
}

const docs = new Lru<Promise<PdfDoc>>(3, (p) => void p.then((d) => d.destroy()).catch(() => {}));
/**
 * Gerenderte Seiten. Eine A4-Seite in voller Breite kostet bei hoher Pixeldichte schnell 30–50 MB – daher
 * nach Bytes begrenzt (Tablets/Handys knapper), nicht nur nach Anzahl.
 */
const BITMAP_BUDGET = (Platform.isMobile ? 48 : 160) * 1024 * 1024;
const bitmaps = new Lru<ImageBitmap>(12, (b) => b.close(), (b) => b.width * b.height * 4, BITMAP_BUDGET);

/** Beim Entladen des Plugins: PDFs schließen, Bitmaps freigeben. */
export function disposeBackgrounds() {
	bitmaps.clear();
	docs.clear();
}

function fileKey(file: TFile) {
	return `${file.path}@${file.stat.mtime}`;
}

export function openPdf(app: App, file: TFile): Promise<PdfDoc> {
	const key = fileKey(file);
	let doc = docs.get(key);
	if (!doc) {
		doc = (async () => {
			const pdfjs = await loadPdfJs();
			const data = await app.vault.readBinary(file);
			return (await pdfjs.getDocument({ data }).promise) as PdfDoc;
		})();
		doc.catch(() => docs.set(key, Promise.reject(new Error("PDF nicht lesbar"))));
		docs.set(key, doc);
	}
	return doc;
}

/** Native Größe aller Seiten (PDF-Punkte bei Scale 1). */
export async function pdfPageSizes(app: App, file: TFile): Promise<{ w: number; h: number }[]> {
	const doc = await openPdf(app, file);
	const sizes: { w: number; h: number }[] = [];
	for (let n = 1; n <= doc.numPages; n++) {
		const vp = (await doc.getPage(n)).getViewport({ scale: 1 });
		sizes.push({ w: vp.width, h: vp.height });
	}
	return sizes;
}

function loadImage(src: string): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const img = new Image();
		img.onload = () => resolve(img);
		img.onerror = () => reject(new Error("Bild nicht lesbar"));
		img.src = src;
	});
}

/** Hintergrund-Info (Art, Seite, native Größe) für eine Datei. */
export async function measureBackground(app: App, file: TFile, page = 1): Promise<InkBackground> {
	const kind = backgroundKind(file);
	if (kind === "pdf") {
		const doc = await openPdf(app, file);
		const n = Math.min(Math.max(1, page), doc.numPages);
		const vp = (await doc.getPage(n)).getViewport({ scale: 1 });
		return { kind, page: n, pw: vp.width, ph: vp.height };
	}
	if (kind === "image") {
		const img = await loadImage(app.vault.getResourcePath(file));
		return { kind, pw: img.naturalWidth, ph: img.naturalHeight };
	}
	throw new Error(`${file.extension}-Dateien werden als Hintergrund nicht unterstützt`);
}

/**
 * Hintergrund einer Arbeitsblatt-Fläche. PDF-Seiten werden passend zur Pixelbreite gerendert (scharf
 * bei jedem DPR) und als ImageBitmap gecacht; Bilder sind ein gestrecktes <img>.
 */
export class PageBackground {
	private canvas: HTMLCanvasElement | null = null;
	private timer = 0;
	private token = 0;
	private renderedWidth = 0;
	/** Laufendes pdf.js-Rendern – wird abgebrochen, sobald es nicht mehr gebraucht wird. */
	private task: { cancel(): void } | null = null;

	constructor(
		private readonly app: App,
		private readonly file: TFile,
		private readonly page: number,
		private readonly el: HTMLElement,
		private readonly onError: (message: string) => void,
	) {
		el.empty();
		if (backgroundKind(file) === "image") {
			const img = el.createEl("img", { cls: "ink-bg-image" });
			img.onerror = () => onError(`Hintergrund nicht lesbar: ${file.path}`);
			img.src = app.vault.getResourcePath(file);
			img.draggable = false;
		} else {
			this.canvas = el.createEl("canvas", { cls: "ink-bg-canvas" });
		}
	}

	get pixelWidth() {
		return this.renderedWidth;
	}

	/** Nach Layout-Änderungen; die erste Darstellung kommt sofort, weitere gebündelt. */
	update(cssWidth: number, dpr: number) {
		if (!this.canvas) return;
		const px = Math.round(cssWidth * dpr);
		if (px === this.renderedWidth) return;
		window.clearTimeout(this.timer);
		if (!this.renderedWidth) void this.render(px);
		else this.timer = window.setTimeout(() => void this.render(px), RERENDER_DELAY);
	}

	destroy() {
		window.clearTimeout(this.timer);
		this.token++;
		this.cancelTask();
		this.el.empty();
	}

	private cancelTask() {
		try {
			this.task?.cancel();
		} catch {
			// schon fertig
		}
		this.task = null;
	}

	private async render(px: number) {
		const canvas = this.canvas;
		if (!canvas) return;
		const token = ++this.token;
		// Ein älteres Rendern (andere Breite) wird nicht mehr gebraucht.
		this.cancelTask();
		const key = `${fileKey(this.file)}#${this.page}@${px}`;
		try {
			let bitmap = bitmaps.get(key);
			if (!bitmap) {
				const doc = await openPdf(this.app, this.file);
				if (this.page > doc.numPages) throw new Error(`Seite ${this.page} gibt es nicht (${doc.numPages} Seiten)`);
				const page = await doc.getPage(this.page);
				const base = page.getViewport({ scale: 1 });
				const viewport = page.getViewport({ scale: px / base.width });
				// Erst offscreen rendern, dann tauschen – kein leeres Aufblitzen beim Neu-Rendern.
				const tmp = document.createElement("canvas");
				tmp.width = Math.round(viewport.width);
				tmp.height = Math.round(viewport.height);
				const ctx = tmp.getContext("2d");
				if (!ctx) return;
				if (token !== this.token) return;
				const task = page.render({ canvasContext: ctx, viewport });
				this.task = task;
				try {
					await task.promise;
				} finally {
					if (this.task === task) this.task = null;
				}
				page.cleanup();
				bitmap = await createImageBitmap(tmp);
				// Zwischen-Canvas sofort freigeben, nicht erst beim nächsten GC
				tmp.width = tmp.height = 0;
				bitmaps.set(key, bitmap);
			}
			if (token !== this.token) return;
			canvas.width = bitmap.width;
			canvas.height = bitmap.height;
			canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
			this.renderedWidth = px;
		} catch (e) {
			if (token === this.token) this.onError(`Hintergrund: ${(e as Error).message ?? String(e)}`);
		}
	}
}
