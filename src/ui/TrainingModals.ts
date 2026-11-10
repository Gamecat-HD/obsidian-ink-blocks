import { Modal, Notice, setIcon } from "obsidian";
import { InkEditor } from "../block/InkEditor";
import type InkBlocksPlugin from "../main";
import { History } from "../model/history";
import { createNotebook, type Stroke } from "../model/ink-format";
import { resolvePattern } from "../model/pattern";
import { editDistance } from "../ocr/benchmark";
import { boxOf, referenceHeight } from "../ocr/segment";
import { strokePath } from "../render/strokes";
import type { InkEntry } from "../store/InkStore";
import { letterPrompts, nextPrompt, vaultWords, type PromptSource } from "../training/prompts";
import { reviewItems, segmentText, UNSURE_CONF, type ReviewItem } from "../training/review";
import { sampleStats, weakChars } from "../training/samples";
import { readLocal, writeLocal } from "../util/local";

const norm = (s: string) => s.replace(/\s+/g, " ").trim();
/** Höhe der Diktat-Fläche in Doc-Einheiten (Breite 1000) – Platz für zwei, drei Zeilen. */
const DICTATION_HEIGHT = 260;
/** „Automatisch weiter“: so lange Ruhe nach dem letzten Strich. */
const AUTO_NEXT_MS = 1600;
const AUTO_KEY = "ink-blocks-dictation-auto";
/** So viele letzte Vorgaben kommen nicht gleich wieder. */
const RECENT = 40;

function penStrokes(strokes: Stroke[]): Stroke[] {
	return strokes.filter((s) => s.tool === "pen" && !s.shape && s.points.length);
}

/** Zähler unten im Dialog: Proben gesamt und Fehlerquote dieser Runde. */
function statsText(total: number, round: { n: number; errors: number; chars: number }): string {
	const cer = round.chars ? ` · Fehler diese Runde ${((round.errors / round.chars) * 100).toFixed(0)} %` : "";
	return `${total} Proben gesammelt · diese Runde ${round.n}${cer}`;
}

/**
 * Diktat: 1–3 Wörter werden vorgegeben, du schreibst sie auf die Fläche, „Weiter“ (Enter) erkennt sie und legt
 * Striche + Vorgabe als Probe ab. Die Erkennung läuft im Hintergrund, die nächste Vorgabe erscheint sofort.
 */
export class DictationModal extends Modal {
	private editor: InkEditor | null = null;
	private readonly entry: InkEntry = { path: "", doc: createNotebook("training", DICTATION_HEIGHT), dirty: false, history: new History(), revealed: new Set() };
	private source: PromptSource | null = null;
	private prompt = "";
	private readonly recent: string[] = [];
	private readonly round = { n: 0, errors: 0, chars: 0 };
	private total = 0;
	private auto = readLocal(AUTO_KEY) === "1";
	private autoTimer = 0;
	private promptEl!: HTMLElement;
	private feedbackEl!: HTMLElement;
	private statsEl!: HTMLElement;

	/** Buchstaben-Training: noch offene Übungszeilen; `null` = normales Diktat. */
	private letterQueue: string[] | null = null;

	/** `letters`: statt Wörtern einzelne Buchstaben, die den Wortvorschlägen noch fehlen. */
	constructor(
		private readonly plugin: InkBlocksPlugin,
		private readonly letters = false,
	) {
		super(plugin.app);
	}

	async onOpen() {
		const { plugin, contentEl, letters } = this;
		this.modalEl.addClass("ink-training-modal");
		this.titleEl.setText(letters ? "Schreibtraining: Buchstaben" : "Schreibtraining: Diktat");
		const header = contentEl.createDiv({ cls: "ink-expanded-header" });
		this.promptEl = contentEl.createDiv({ cls: "ink-training-prompt", text: "Lade Wörter …" });
		contentEl.createDiv({
			cls: "ink-training-hint",
			text: letters ? "Schreib jeden Buchstaben einzeln mit großem Abstand, alle auf einer Linie." : "Schreib die Wörter so, wie du sonst schreibst – auf die Linien, in einer Zeile.",
		});
		const container = contentEl.createDiv({ cls: "ink-block ink-training-surface is-active" });
		this.editor = new InkEditor(container, {
			plugin,
			entry: this.entry,
			pattern: () => resolvePattern({}, plugin.settings),
			setPattern: () => {},
			background: null,
			commit: () => this.armAuto(),
			activate: () => this.editor?.surface.el.focus({ preventScroll: true }),
			noSuggestions: true,
		});
		header.appendChild(this.editor.toolbar.el);

		const actions = contentEl.createDiv({ cls: "ink-training-actions" });
		const autoLabel = actions.createEl("label", { cls: "ink-training-auto" });
		const autoBox = autoLabel.createEl("input", { type: "checkbox" });
		autoBox.checked = this.auto;
		autoLabel.appendText(" Automatisch weiter");
		autoLabel.title = "Nach kurzer Schreibpause geht es von selbst weiter – praktisch mit dem Stift.";
		autoBox.addEventListener("change", () => {
			this.auto = autoBox.checked;
			writeLocal(AUTO_KEY, this.auto ? "1" : "0");
			this.armAuto();
		});
		actions.createDiv({ cls: "ink-training-spacer" });
		this.button(actions, "eraser", "Neu schreiben", () => this.clear());
		this.button(actions, "skip-forward", "Überspringen", () => this.showPrompt());
		this.button(actions, "check", "Weiter (Enter)", () => void this.next(), true);
		this.feedbackEl = contentEl.createDiv({ cls: "ink-training-feedback" });
		this.statsEl = contentEl.createDiv({ cls: "ink-training-stats" });

		this.scope.register([], "Enter", () => (void this.next(), false));
		this.scope.register(["Mod"], "z", () => (this.editor?.undo(), false));
		this.scope.register(["Mod", "Shift"], "z", () => (this.editor?.redo(), false));

		if (letters) {
			const library = await plugin.suggest.glyphLibrary();
			this.letterQueue = letterPrompts((ch) => library.needsPractice(ch));
			if (!this.letterQueue.length) {
				this.promptEl.setText("Alle Buchstaben sind schon da.");
				return;
			}
			this.showPrompt();
			this.editor.surface.el.focus({ preventScroll: true });
			return;
		}

		if (!(await plugin.ocr.readyEngines()).length) {
			this.promptEl.setText("Die Texterkennung hat noch keine Modelle – Einstellungen → Ink Blocks → „Herunterladen“.");
			return;
		}
		const [lines, samples] = await Promise.all([plugin.ocr.corpusLines(), plugin.training.load()]);
		this.total = sampleStats(samples).count;
		this.source = {
			words: vaultWords(lines),
			hotwords: plugin.settings.ocrHotwords.split(/[\n,;]/).map((w) => w.trim()).filter(Boolean),
			weak: weakChars(samples),
		};
		this.updateStats();
		this.showPrompt();
		this.editor.surface.el.focus({ preventScroll: true });
	}

	private button(parent: HTMLElement, icon: string, label: string, run: () => void, cta = false) {
		const b = parent.createEl("button", { cls: cta ? "mod-cta" : "" });
		setIcon(b.createSpan({ cls: "ink-training-icon" }), icon);
		b.appendText(label);
		b.addEventListener("click", run);
		return b;
	}

	private showPrompt() {
		if (this.letterQueue) {
			const line = this.letterQueue.shift();
			if (!line) {
				new Notice("Geschafft! Deine Buchstaben werden ab jetzt verwendet.", 3000);
				this.close();
				return;
			}
			this.prompt = line;
			this.promptEl.setText(line);
			this.statsEl.setText(`Noch ${this.letterQueue.length + 1} Zeilen`);
			this.clear();
			return;
		}
		if (!this.source) return;
		this.prompt = nextPrompt(this.source, new Set(this.recent));
		this.recent.push(this.prompt, ...this.prompt.split(" "));
		this.recent.splice(0, Math.max(0, this.recent.length - RECENT));
		this.promptEl.setText(this.prompt);
		this.clear();
	}

	private clear() {
		window.clearTimeout(this.autoTimer);
		this.entry.doc = createNotebook("training", DICTATION_HEIGHT);
		this.entry.history = new History();
		this.editor?.setDoc();
		this.editor?.surface.resize();
		this.editor?.surface.redrawAll();
	}

	private armAuto() {
		window.clearTimeout(this.autoTimer);
		if (!this.auto || !penStrokes(this.entry.doc.strokes).length) return;
		this.autoTimer = window.setTimeout(() => {
			if (this.editor?.busy) this.armAuto();
			else void this.next();
		}, AUTO_NEXT_MS);
	}

	/** Geschriebenes erkennen und als Probe ablegen; sofort weiter mit der nächsten Vorgabe. */
	private async next() {
		const strokes = penStrokes(this.entry.doc.strokes);
		if ((!this.source && !this.letterQueue) || !this.prompt) return;
		if (!strokes.length) {
			new Notice("Erst die Wörter schreiben – oder „Überspringen“.", 2500);
			return;
		}
		const prompt = this.prompt;
		this.showPrompt();
		if (this.letters) {
			await this.plugin.training.add({ text: prompt, got: "", source: "letters", engine: "", strokes: strokes.map((s) => s.points), refHeight: referenceHeight(strokes) });
			return;
		}
		const recognized = await this.plugin.ocr.recognizeStrokes(strokes);
		if (recognized === null) {
			new Notice("Texterkennung nicht verfügbar – die Probe wurde nicht gespeichert.", 4000);
			return;
		}
		const got = norm(recognized);
		const errors = editDistance(norm(prompt), got);
		await this.plugin.training.add({
			text: prompt,
			got,
			source: "dictation",
			engine: this.plugin.ocr.engineVersion,
			strokes: strokes.map((s) => s.points),
			refHeight: referenceHeight(strokes),
		});
		this.total++;
		this.round.n++;
		this.round.errors += errors;
		this.round.chars += Array.from(norm(prompt)).length;
		this.showFeedback(prompt, got, errors);
		this.updateStats();
		// Alle zehn Proben die schwachen Zeichen neu bestimmen.
		if (this.round.n % 10 === 0 && this.source) this.source.weak = weakChars(await this.plugin.training.load());
	}

	private showFeedback(prompt: string, got: string, errors: number) {
		const row = createDiv({ cls: `ink-training-result ${errors ? "is-wrong" : "is-right"}` });
		setIcon(row.createSpan({ cls: "ink-training-icon" }), errors ? "x" : "check");
		row.createSpan({ text: prompt, cls: "ink-training-want" });
		row.createSpan({ text: " → " });
		row.createSpan({ text: got || "(nichts erkannt)", cls: "ink-training-got" });
		if (errors) row.createSpan({ text: ` · ${errors} Fehler`, cls: "ink-training-count" });
		this.feedbackEl.prepend(row);
		while (this.feedbackEl.childElementCount > 3) this.feedbackEl.lastElementChild?.remove();
	}

	private updateStats() {
		this.statsEl.setText(statsText(this.total, this.round));
	}

	onClose() {
		window.clearTimeout(this.autoTimer);
		this.editor?.destroy();
		this.editor = null;
		this.contentEl.empty();
		this.plugin.ocr.markCorpusStale();
	}
}

/** Ein ink-Block, dessen Erkennung überprüft wird. */
export interface ReviewSource {
	inkPath: string;
	/** Notiz mit dem Block (für das `text:`-Feld); `null` = nicht gefunden, dann nur die .ink-Datei */
	notePath: string | null;
	/** Zeile des Blocks in der Notiz (Hinweis) */
	line?: number;
}

/**
 * Überprüfen: erkannte Wörter einzeln mit ihren Strichen zeigen, unsicherste zuerst. „Richtig“, „Übernehmen“
 * (korrigiert), „Kein Text“ oder „Überspringen“. Bestätigte und korrigierte Wörter werden Proben, Korrekturen
 * landen zusätzlich sofort im Block.
 */
export class ReviewModal extends Modal {
	/** Alle gefundenen Wörter (ungefiltert); die Warteschlange ergibt sich daraus. */
	private readonly found: ReviewItem[] = [];
	private queue: ReviewItem[] = [];
	private current: ReviewItem | null = null;
	private readonly entries = new Map<string, InkEntry>();
	private readonly touched = new Set<string>();
	private reviewed = new Set<string>();
	/** In dieser Sitzung übersprungen (beim nächsten Mal wieder dabei) */
	private readonly skipped = new Set<string>();
	private loading = true;
	private closed = false;
	private done = 0;
	private engine = "";
	private refHeights = new Map<string, number>();
	private onlyUnsure = true;
	private canvas!: HTMLCanvasElement;
	private input!: HTMLInputElement;
	private altsEl!: HTMLElement;
	private statusEl!: HTMLElement;
	private bodyEl!: HTMLElement;
	private readonly listener = () => {};

	constructor(
		private readonly plugin: InkBlocksPlugin,
		private readonly sources: ReviewSource[],
	) {
		super(plugin.app);
	}

	async onOpen() {
		const { contentEl } = this;
		this.modalEl.addClass("ink-training-modal", "ink-review-modal");
		this.titleEl.setText("Schreibtraining: Erkennung überprüfen");
		const top = contentEl.createDiv({ cls: "ink-training-actions" });
		const label = top.createEl("label", { cls: "ink-training-auto" });
		const box = label.createEl("input", { type: "checkbox" });
		box.checked = this.onlyUnsure;
		label.appendText(" Nur unsichere Wörter");
		box.addEventListener("change", () => {
			this.onlyUnsure = box.checked;
			this.refill();
			if (!this.current) this.showNext();
			this.updateStatus();
		});
		top.createDiv({ cls: "ink-training-spacer" });
		this.statusEl = top.createDiv({ cls: "ink-training-stats" });

		this.bodyEl = contentEl.createDiv({ cls: "ink-review-body" });
		this.canvas = this.bodyEl.createEl("canvas", { cls: "ink-review-preview" });
		this.input = this.bodyEl.createEl("input", { type: "text", cls: "ink-review-input", attr: { autocapitalize: "off", autocomplete: "off", spellcheck: "false" } });
		this.altsEl = this.bodyEl.createDiv({ cls: "ink-review-alts" });
		const actions = this.bodyEl.createDiv({ cls: "ink-training-actions" });
		this.button(actions, "ban", "Kein Text", () => void this.decide("none"));
		this.button(actions, "skip-forward", "Überspringen", () => {
			if (this.current) this.skipped.add(this.current.key);
			this.showNext();
		});
		actions.createDiv({ cls: "ink-training-spacer" });
		this.button(actions, "check", "Richtig", () => void this.decide("ok"));
		this.button(actions, "pencil", "Übernehmen (Enter)", () => void this.decide("fix"), true);
		this.input.addEventListener("keydown", (e) => {
			if (e.key !== "Enter") return;
			e.preventDefault();
			void this.decide(this.input.value.trim() === this.current?.word ? "ok" : "fix");
		});
		this.bodyEl.hide();
		this.updateStatus();

		this.reviewed = new Set((await this.plugin.training.load()).map((s) => s.key).filter((k): k is string => !!k));
		void this.load();
	}

	private button(parent: HTMLElement, icon: string, label: string, run: () => void, cta = false) {
		const b = parent.createEl("button", { cls: cta ? "mod-cta" : "" });
		setIcon(b.createSpan({ cls: "ink-training-icon" }), icon);
		b.appendText(label);
		b.addEventListener("click", run);
	}

	/** Blöcke nacheinander erkennen; Wörter kommen in die Warteschlange, sobald ihr Block fertig ist. */
	private async load() {
		for (const src of this.sources) {
			if (this.closed) return;
			const entry = await this.plugin.store.acquire(src.inkPath, this.listener).catch(() => null);
			if (!entry) continue;
			this.entries.set(src.inkPath, entry);
			const detailed = await this.plugin.ocr.recognizeDetailed(entry.doc.strokes);
			if (!detailed) {
				this.statusEl.setText("Die Texterkennung hat noch keine Modelle – Einstellungen → Ink Blocks → „Herunterladen“.");
				this.loading = false;
				return;
			}
			this.engine = detailed.engine;
			this.refHeights.set(src.inkPath, detailed.refHeight);
			const fixed = entry.doc.ocr?.fixed ?? {};
			for (const { seg, result } of detailed.lines.flat()) {
				if (seg.key in fixed) continue;
				this.found.push(...reviewItems(src.inkPath, seg, result));
			}
			this.refill();
			if (!this.current) this.showNext();
			this.updateStatus();
		}
		this.loading = false;
		if (!this.current) this.showNext();
		this.updateStatus();
	}

	/** Warteschlange neu: noch nicht geprüfte Wörter (ggf. nur unsichere), unsicherste zuerst. */
	private refill() {
		this.queue = this.found
			.filter((i) => i !== this.current && !this.reviewed.has(i.key) && !this.skipped.has(i.key) && (!this.onlyUnsure || i.conf < UNSURE_CONF))
			.sort((a, b) => a.conf - b.conf);
	}

	private showNext() {
		this.current = this.queue.shift() ?? null;
		this.updateStatus();
		if (!this.current) {
			this.bodyEl.hide();
			return;
		}
		const item = this.current;
		this.bodyEl.show();
		this.input.value = item.word;
		this.altsEl.empty();
		for (const alt of item.alts) {
			const chip = this.altsEl.createEl("button", { cls: "ink-review-alt", text: alt });
			chip.addEventListener("click", () => {
				this.input.value = alt;
				void this.decide("fix");
			});
		}
		this.drawPreview(item);
		this.input.focus();
		this.input.select();
	}

	private updateStatus() {
		const left = this.queue.length + (this.current ? 1 : 0);
		const parts = [`${this.done} geprüft`, `${left} offen`];
		if (this.loading) parts.push("suche weitere …");
		else if (!left) parts.push(this.done ? "fertig – danke!" : "nichts Unsicheres gefunden");
		this.statusEl.setText(parts.join(" · "));
	}

	/** Ausschnitt um das Wort: Nachbarwörter blass, das Wort in Tintenfarbe auf einem Akzent-Band. */
	private drawPreview(item: ReviewItem) {
		const canvas = this.canvas;
		const style = getComputedStyle(this.contentEl);
		const ink = style.getPropertyValue("--text-normal").trim() || "#222";
		const faint = style.getPropertyValue("--text-faint").trim() || "#999";
		const accent = style.getPropertyValue("--interactive-accent").trim() || "#7c3aed";
		const wb = boxOf(item.strokes);
		const sb = item.seg.box;
		const h = Math.max(sb.maxY - sb.minY, 10);
		const view = {
			x0: Math.max(sb.minX, wb.minX - 2 * h) - 0.3 * h,
			x1: Math.min(sb.maxX, wb.maxX + 2 * h) + 0.3 * h,
			y0: sb.minY - 0.35 * h,
			y1: sb.maxY + 0.35 * h,
		};
		const cssW = Math.max(240, canvas.clientWidth || this.bodyEl.clientWidth || 560);
		const cssH = 150;
		const dpr = window.devicePixelRatio || 1;
		canvas.width = Math.round(cssW * dpr);
		canvas.height = Math.round(cssH * dpr);
		canvas.style.height = `${cssH}px`;
		const ctx = canvas.getContext("2d");
		if (!ctx) return;
		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.clearRect(0, 0, canvas.width, canvas.height);
		const scale = Math.min(cssW / (view.x1 - view.x0), cssH / (view.y1 - view.y0));
		const ox = (cssW - (view.x1 - view.x0) * scale) / 2 - view.x0 * scale;
		const oy = (cssH - (view.y1 - view.y0) * scale) / 2 - view.y0 * scale;
		ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * ox, dpr * oy);
		ctx.globalAlpha = 0.14;
		ctx.fillStyle = accent;
		ctx.fillRect(wb.minX - 0.2 * h, view.y0, wb.maxX - wb.minX + 0.4 * h, view.y1 - view.y0);
		ctx.globalAlpha = 1;
		const own = new Set(item.strokes);
		for (const s of item.seg.strokes) {
			ctx.fillStyle = own.has(s) ? ink : faint;
			ctx.fill(strokePath(s));
		}
	}

	private async decide(kind: "ok" | "fix" | "none") {
		const item = this.current;
		if (!item) return;
		const typed = this.input.value.trim().replace(/\s+/g, " ");
		const text = kind === "none" || (kind === "fix" && !typed) ? null : kind === "ok" ? item.word : typed;
		this.done++;
		this.reviewed.add(item.key);
		this.showNext();
		await this.plugin.training.add({
			text,
			got: item.word,
			source: "review",
			engine: this.engine,
			strokes: item.strokes.map((s) => s.points),
			refHeight: this.refHeights.get(item.seg.inkPath) ?? referenceHeight(item.seg.strokes),
			key: item.key,
			inkPath: item.seg.inkPath,
		});
		if (text === item.word) return;
		item.seg.words[item.index] = text ?? "";
		const entry = this.entries.get(item.seg.inkPath);
		if (entry) {
			this.plugin.ocr.applyCorrection(entry, item.seg.key, segmentText(item.seg));
			this.touched.add(item.seg.inkPath);
		}
	}

	onClose() {
		this.closed = true;
		this.contentEl.empty();
		const { plugin } = this;
		plugin.ocr.markCorpusStale();
		void (async () => {
			// Korrigierte Blöcke: `text:` in der Notiz neu schreiben (aus dem Cache, ohne neue Erkennung).
			for (const src of this.sources) {
				const entry = this.entries.get(src.inkPath);
				if (!entry || !this.touched.has(src.inkPath) || !src.notePath) continue;
				await plugin.ocr
					.run({ entry, inkPath: src.inkPath, notePath: src.notePath, hint: () => src.line, busy: () => false })
					.catch((e) => console.warn("[ink-blocks] Korrektur nicht geschrieben", e));
			}
			for (const entry of this.entries.values()) plugin.store.release(entry, this.listener);
			this.entries.clear();
		})();
	}
}
