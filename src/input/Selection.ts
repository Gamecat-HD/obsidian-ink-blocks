import { Menu, Notice } from "obsidian";
import type InkBlocksPlugin from "../main";
import type { Stroke } from "../model/ink-format";
import { applyOp, strokeBounds, replaceOp, type Bounds, type InkOp } from "../model/ops";
import {
	clampMove,
	grownHeight,
	IDENTITY,
	isIdentity,
	recolorStroke,
	selectionBounds,
	transformBounds,
	transformStroke,
	type Transform,
} from "../model/selection";
import { HL_ALPHA, HL_COLORS, PALETTE, PEN_COLORS, strokePath } from "../render/strokes";
import type { Surface } from "../render/Surface";
import type { InkEntry } from "../store/InkStore";
import { SelectionLayer } from "../ui/SelectionLayer";
import { shortId } from "../util/ids";

/** Kopierte Striche – gilt für alle Blöcke (Kopieren in einem, Einfügen in einem anderen). */
export interface InkClipboard {
	strokes: Stroke[];
	/** Breite des Quelldokuments: beim Einfügen in eine andere Breite wird mitskaliert. */
	w: number;
	/** Aus welchem Dokument (gleiches Dokument → versetzt einfügen). */
	docId: string;
}

export interface SelectionHost {
	plugin: InkBlocksPlugin;
	entry: InkEntry;
	surface: Surface;
	/** Op ist bereits angewendet: History, Speichern, Texterkennung. */
	onOp(op: InkOp): void;
	/** Text als Absatz unter den Block schreiben (fehlt in Ansichten ohne Notiz). */
	insertText?: (text: string) => Promise<boolean>;
}

/** Versatz beim Duplizieren bzw. Einfügen ins selbe Dokument (Doc-Einheiten). */
const PASTE_OFFSET = 24;
const MIN_SIZE = 8;
const MAX_SCALE = 6;

const COLOR_NAMES = ["Tinte", "Blau", "Rot", "Gelb", "Grün", "Pink", "Hellblau", "Orange", "Lila"];

/**
 * Lasso-Auswahl eines Editors: welche Striche angehoben sind, die laufende Transformation und alle Aktionen
 * (Löschen, Kopieren, Einfügen, Umfärben, Text). Jede abgeschlossene Änderung ist eine Op mit neuen Strich-IDs.
 */
export class Selection {
	readonly layer: SelectionLayer;
	private ids = new Set<string>();
	private strokes: Stroke[] = [];
	private base: Bounds | null = null;
	private t: Transform = IDENTITY;
	private colors: HTMLElement | null = null;

	constructor(private readonly host: SelectionHost) {
		this.layer = new SelectionLayer(host.surface, [
			{ id: "delete", icon: "trash-2", label: "Löschen (Entf)", run: () => this.delete() },
			{ id: "cut", icon: "scissors", label: "Ausschneiden (Strg+X)", run: () => this.cut() },
			{ id: "copy", icon: "copy", label: "Kopieren (Strg+C)", run: () => this.copy() },
			{ id: "duplicate", icon: "copy-plus", label: "Duplizieren (Strg+D)", run: () => this.duplicate() },
			{ id: "color", icon: "palette", label: "Farbe ändern", run: () => this.toggleColors() },
			{ id: "text", icon: "type", label: "In Text umwandeln", run: (btn) => this.textMenu(btn) },
			{ id: "image", icon: "image", label: "Als Bild kopieren", run: () => void this.copyImage() },
		]);
	}

	get active(): boolean {
		return this.ids.size > 0;
	}

	get selectedIds(): ReadonlySet<string> {
		return this.ids;
	}

	destroy() {
		this.layer.destroy();
	}

	set(ids: Iterable<string>) {
		const want = new Set(ids);
		this.strokes = this.host.entry.doc.strokes.filter((s) => want.has(s.id));
		this.ids = new Set(this.strokes.map((s) => s.id));
		this.t = IDENTITY;
		this.base = selectionBounds(this.strokes);
		this.closeColors();
		this.host.surface.setHidden(this.ids);
		if (!this.base) return this.clear();
		this.layer.setStrokes(this.strokes);
		this.render(false);
	}

	clear() {
		this.ids = new Set();
		this.strokes = [];
		this.base = null;
		this.t = IDENTITY;
		this.closeColors();
		this.host.surface.setHidden(this.ids);
		this.layer.hide();
	}

	selectAll() {
		this.set(this.host.entry.doc.strokes.map((s) => s.id));
	}

	/** Nach Undo, Sync oder Änderungen in einer anderen Ansicht: verschwundene Striche abwählen. */
	validate() {
		if (!this.active) return;
		const present = new Set(this.host.entry.doc.strokes.map((s) => s.id));
		const still = [...this.ids].filter((id) => present.has(id));
		if (still.length === this.ids.size) {
			this.layer.sync();
			return;
		}
		if (still.length) this.set(still);
		else this.clear();
	}

	hitHandle(x: number, y: number) {
		return this.active && this.layer.hitHandle(x, y);
	}

	hitFrame(x: number, y: number) {
		return this.active && this.layer.hitFrame(x, y);
	}

	/** Umrandung der unveränderten Auswahl (Ursprung fürs Skalieren). */
	get bounds(): Bounds | null {
		return this.base;
	}

	// ---- Verschieben / Skalieren (Gesten aus der PointerPipeline) ----

	/** Verschieben um (dx, dy) Doc-Einheiten, auf die Fläche begrenzt. */
	moveTo(dx: number, dy: number) {
		if (!this.base) return;
		const doc = this.host.entry.doc;
		const [x, y] = clampMove(this.base, dx, dy, doc.w, doc.space === "page" ? doc.h : null);
		this.t = { dx: x, dy: y, scale: 1, ox: 0, oy: 0 };
		this.grow();
		this.render(true);
	}

	/** Gleichmäßig skalieren mit der oberen linken Ecke als Ursprung. */
	scaleTo(scale: number) {
		const b = this.base;
		if (!b) return;
		const doc = this.host.entry.doc;
		const size = Math.max(b.maxX - b.minX, b.maxY - b.minY, 1);
		let s = Math.max(MIN_SIZE / size, Math.min(MAX_SCALE, scale));
		// Nicht über den rechten Rand bzw. (Arbeitsblatt) den unteren Rand hinaus.
		s = Math.min(s, (doc.w - b.minX) / Math.max(1, b.maxX - b.minX));
		if (doc.space === "page") s = Math.min(s, (doc.h - b.minY) / Math.max(1, b.maxY - b.minY));
		this.t = { dx: 0, dy: 0, scale: s, ox: b.minX, oy: b.minY };
		this.grow();
		this.render(true);
	}

	/** Transformation als Op festschreiben; die neuen Striche bleiben ausgewählt. */
	commitTransform(hStart: number) {
		if (!this.active || isIdentity(this.t)) {
			this.t = IDENTITY;
			this.render(false);
			return;
		}
		const t = this.t;
		this.replace(this.strokes.map((s) => transformStroke(s, t, shortId(6))), hStart);
	}

	/** Pfeiltasten: um `dx`/`dy` verschieben und gleich festschreiben. */
	nudge(dx: number, dy: number) {
		if (!this.active) return;
		const h = this.host.entry.doc.h;
		this.moveTo(dx, dy);
		this.commitTransform(h);
	}

	private grow() {
		const doc = this.host.entry.doc;
		if (!this.base || doc.space !== "nb") return;
		const h = grownHeight(doc.h, transformBounds(this.t, this.base).maxY);
		if (h === doc.h) return;
		doc.h = h;
		this.host.surface.resize();
	}

	private render(dragging: boolean) {
		if (this.base) this.layer.show(this.base, this.t, dragging);
	}

	/** Auswahl durch `added` ersetzen (neue IDs), als eine Op. */
	private replace(added: Stroke[], hStart = this.host.entry.doc.h) {
		const { entry, surface } = this.host;
		const op = replaceOp(entry.doc, this.ids, added, entry.doc.h);
		op.hBefore = hStart;
		applyOp(entry.doc, op);
		this.host.onOp(op);
		surface.resize();
		this.set(added.map((s) => s.id));
	}

	// ---- Aktionen ----

	delete() {
		if (!this.active) return;
		const { entry, surface } = this.host;
		const removed = entry.doc.strokes.map((stroke, index) => ({ stroke, index })).filter((r) => this.ids.has(r.stroke.id));
		const op: InkOp = { kind: "erase", removed };
		const bounds = removed.map((r) => strokeBounds(r.stroke));
		this.clear();
		applyOp(entry.doc, op);
		surface.redraw(bounds);
		this.host.onOp(op);
	}

	copy() {
		if (!this.active) return;
		const doc = this.host.entry.doc;
		this.host.plugin.clipboard = { strokes: this.strokes.map((s) => ({ ...s, points: s.points.slice() })), w: doc.w, docId: doc.id };
		new Notice(`${this.strokes.length} ${this.strokes.length === 1 ? "Strich" : "Striche"} kopiert`, 1500);
	}

	cut() {
		this.copy();
		this.delete();
	}

	duplicate() {
		if (!this.active) return;
		const copies = this.strokes.map((s) => transformStroke(s, { dx: PASTE_OFFSET, dy: PASTE_OFFSET, scale: 1, ox: 0, oy: 0 }, shortId(6)));
		this.paste(copies);
	}

	/**
	 * Zwischenablage einfügen: an `at` (obere linke Ecke, Doc-Einheiten), sonst an der Originalstelle –
	 * im selben Dokument versetzt. Die eingefügten Striche sind danach ausgewählt.
	 */
	pasteClipboard(at?: { x: number; y: number }) {
		const clip = this.host.plugin.clipboard;
		if (!clip?.strokes.length) return false;
		const doc = this.host.entry.doc;
		const scale = doc.w / clip.w;
		const b = selectionBounds(clip.strokes);
		if (!b) return false;
		let t: Transform = { dx: 0, dy: 0, scale, ox: 0, oy: 0 };
		if (at) t = { dx: at.x - b.minX * scale, dy: at.y - b.minY * scale, scale, ox: 0, oy: 0 };
		else if (clip.docId === doc.id) t = { ...t, dx: PASTE_OFFSET, dy: PASTE_OFFSET };
		this.paste(clip.strokes.map((s) => transformStroke(s, t, shortId(6))));
		return true;
	}

	/** Neue Striche als eine Op hinzufügen (auf die Fläche geschoben) und auswählen. */
	private paste(strokes: Stroke[]) {
		const { entry } = this.host;
		const doc = entry.doc;
		const b = selectionBounds(strokes);
		if (!b) return;
		const [dx, dy] = clampMove(b, 0, 0, doc.w, doc.space === "page" ? doc.h : null);
		const placed = dx || dy ? strokes.map((s) => transformStroke(s, { dx, dy, scale: 1, ox: 0, oy: 0 }, s.id)) : strokes;
		const hAfter = doc.space === "nb" ? grownHeight(doc.h, b.maxY + dy) : doc.h;
		this.ids = new Set();
		const op = replaceOp(doc, this.ids, placed, hAfter);
		applyOp(doc, op);
		this.host.onOp(op);
		this.host.surface.resize();
		this.set(placed.map((s) => s.id));
	}

	recolor(color: number) {
		if (!this.active) return;
		const hl = HL_COLORS.includes(color);
		// Stiftfarben färben Stifte (und Formen), Markerfarben die Textmarker – die Deckkraft bleibt so stimmig.
		const changed = this.strokes.some((s) => (s.tool === "hl") === hl && s.color !== color);
		if (!changed) return;
		this.replace(this.strokes.map((s) => ((s.tool === "hl") === hl ? recolorStroke(s, color, shortId(6)) : { ...s, id: shortId(6) })));
	}

	/** Rechtsklick bzw. Tippen mit dem Lasso ins Leere: Einfügen, Alles auswählen (bei Auswahl deren Aktionen). */
	contextMenu(clientX: number, clientY: number, at: { x: number; y: number }, tapOnly = false) {
		const menu = new Menu();
		let items = 0;
		const add = (title: string, icon: string, run: () => void) => {
			items++;
			menu.addItem((i) => i.setTitle(title).setIcon(icon).onClick(run));
		};
		if (this.active && this.hitFrame(at.x, at.y)) {
			add("Ausschneiden", "scissors", () => this.cut());
			add("Kopieren", "copy", () => this.copy());
			add("Duplizieren", "copy-plus", () => this.duplicate());
			add("Löschen", "trash-2", () => this.delete());
		} else {
			if (this.host.plugin.clipboard?.strokes.length) add("Hier einfügen", "clipboard-paste", () => this.pasteClipboard(at));
			if (!tapOnly && this.host.entry.doc.strokes.length) add("Alles auswählen", "box-select", () => this.selectAll());
		}
		if (items) menu.showAtPosition({ x: clientX, y: clientY });
	}

	private toggleColors() {
		if (this.colors) return this.closeColors();
		const kinds = new Set(this.strokes.map((s) => (s.tool === "hl" ? "hl" : "pen")));
		const box = this.layer.bar.createDiv({ cls: "ink-selection-colors" });
		const ink = this.host.entry.doc.space === "page" ? "#111" : "var(--text-normal)";
		for (const [kind, list] of [["pen", PEN_COLORS], ["hl", HL_COLORS]] as const) {
			if (!kinds.has(kind)) continue;
			const row = box.createDiv({ cls: "ink-selection-color-row" });
			for (const c of list) {
				const sw = row.createEl("button", { cls: "ink-tb-swatch clickable-icon", attr: { "aria-label": COLOR_NAMES[c] ?? "" } });
				sw.dataset.color = String(c);
				sw.style.setProperty("--swatch", PALETTE[c] === "ink" ? ink : PALETTE[c]);
				if (kind === "hl") sw.style.setProperty("--swatch-alpha", String(HL_ALPHA + 0.25));
				sw.addEventListener("click", () => this.recolor(c));
			}
		}
		this.colors = box;
	}

	private closeColors() {
		this.colors?.remove();
		this.colors = null;
	}

	private textMenu(btn: HTMLElement) {
		const pen = this.strokes.filter((s) => s.tool === "pen" && !s.shape);
		if (!pen.length) {
			new Notice("Keine Handschrift in der Auswahl.");
			return;
		}
		const run = async (mode: "copy" | "insert" | "replace") => {
			const notice = new Notice("Erkenne Handschrift …", 0);
			const text = await this.host.plugin.ocr.recognizeStrokes(pen).finally(() => notice.hide());
			if (text === null) return new Notice("Texterkennung: Modelle fehlen – Einstellungen → Ink Blocks → „Herunterladen“.");
			if (!text.trim()) return new Notice("Nichts erkannt.");
			if (mode === "copy") {
				await navigator.clipboard.writeText(text);
				return new Notice(`Kopiert: ${text}`);
			}
			const ok = await this.host.insertText?.(text);
			if (!ok) return new Notice("Block in der Notiz nicht gefunden.");
			if (mode === "replace") this.delete();
		};
		const menu = new Menu();
		menu.addItem((i) => i.setTitle("Text kopieren").setIcon("clipboard-copy").onClick(() => void run("copy")));
		if (this.host.insertText) {
			menu.addItem((i) => i.setTitle("Als Text unter dem Block einfügen").setIcon("text-cursor-input").onClick(() => void run("insert")));
			menu.addItem((i) => i.setTitle("In Text umwandeln (Handschrift löschen)").setIcon("replace").onClick(() => void run("replace")));
		}
		const r = btn.getBoundingClientRect();
		menu.showAtPosition({ x: r.left, y: r.bottom + 4 });
	}

	/** PNG der Auswahl in die System-Zwischenablage (transparent, doppelte Auflösung). */
	async copyImage() {
		const b = this.base;
		if (!b) return;
		const scale = Math.min(4, 2 * this.host.surface.docScale * (window.devicePixelRatio || 1));
		const canvas = document.createElement("canvas");
		canvas.width = Math.ceil((b.maxX - b.minX) * scale);
		canvas.height = Math.ceil((b.maxY - b.minY) * scale);
		const ctx = canvas.getContext("2d");
		if (!ctx) return;
		ctx.setTransform(scale, 0, 0, scale, -b.minX * scale, -b.minY * scale);
		for (const hl of [true, false]) {
			ctx.globalAlpha = hl ? HL_ALPHA : 1;
			for (const s of this.strokes) {
				if ((s.tool === "hl") !== hl) continue;
				ctx.fillStyle = this.host.surface.color(s.color);
				ctx.fill(strokePath(s));
			}
		}
		const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/png"));
		if (!blob) return;
		try {
			await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
			new Notice("Als Bild kopiert", 1500);
		} catch (e) {
			new Notice(`Bild kopieren fehlgeschlagen: ${(e as Error).message}`);
		}
	}
}
