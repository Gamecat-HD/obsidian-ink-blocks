import { Menu, normalizePath, Notice, type Editor, type MarkdownFileInfo, type MarkdownView, type TFile } from "obsidian";
import { formatBgLink } from "./block/bgLink";
import { findInkFences } from "./block/locate";
import { parseBlock, setField } from "./block/source";
import type InkBlocksPlugin from "./main";
import { PenDiagnosticsModal } from "./diagnostics";
import { createNotebook, createPage } from "./model/ink-format";
import { backgroundKind, measureBackground, openPdf } from "./render/background";
import { WorksheetFileModal, WorksheetPageModal } from "./ui/WorksheetModal";
import { benchmarkNote, benchmarkReport, parseBenchmark, upsertReport } from "./ocr/benchmark";
import { ENGINES } from "./ocr/models";
import { rasterizeSegment } from "./ocr/raster";
import { referenceHeight, segmentLines } from "./ocr/segment";
import { convertEmbedAtLine } from "./ui/EmbedAnnotator";
import { OrphanModal } from "./ui/OrphanModal";
import { DictationModal, ReviewModal, type ReviewSource } from "./ui/TrainingModals";
import { runTuning } from "./training/runTuning";
import { inkFileName, shortId } from "./util/ids";

export function registerCommands(plugin: InkBlocksPlugin) {
	plugin.addCommand({
		id: "insert-notebook",
		name: "Schreibfläche einfügen",
		editorCallback: (editor, ctx) => void insertNotebook(plugin, editor, ctx),
	});

	plugin.addCommand({
		id: "insert-worksheet",
		name: "Arbeitsblatt einfügen (PDF/Bild)",
		editorCallback: (editor, ctx) => {
			const note = ctx.file;
			if (!note) return;
			new WorksheetFileModal(plugin.app, (file) => void pickPages(plugin, editor, note, file)).open();
		},
	});

	plugin.addCommand({
		id: "toggle-suggestions",
		name: "Wortvorschläge ein- oder ausschalten",
		callback: () => plugin.suggest.toggle(),
	});

	plugin.addCommand({
		id: "annotate-embed",
		name: "Bild/PDF in dieser Zeile beschriftbar machen",
		editorCallback: (editor, ctx) => {
			if (ctx.file) void convertEmbedAtLine(plugin, editor, ctx.file, editor.getCursor().line);
		},
	});

	plugin.addCommand({
		id: "recognize-note",
		name: "Handschrift in dieser Notiz erkennen",
		editorCallback: (editor, ctx) => {
			if (ctx.file) void recognizeNote(plugin, ctx.file.path, editor.getValue());
		},
	});

	plugin.addCommand({
		id: "download-models",
		name: "Texterkennung: Modelle herunterladen",
		callback: async () => {
			const spec = ENGINES[plugin.ocr.candidates()[0]];
			const notice = new Notice(`Lade ${spec.label} …`, 0);
			try {
				await plugin.ocr.models.download(spec, (f, i, n) => notice.setMessage(`Lade ${i + 1}/${n}: ${f.path}`));
				plugin.ocr.reset();
				notice.setMessage("Texterkennung bereit.");
			} catch (e) {
				notice.setMessage(`Download fehlgeschlagen: ${(e as Error).message}`);
			}
			window.setTimeout(() => notice.hide(), 4000);
		},
	});

	plugin.addCommand({
		id: "find-orphans",
		name: "Verwaiste Ink-Dateien finden",
		callback: async () => new OrphanModal(plugin.app, await findOrphans(plugin)).open(),
	});

	plugin.addCommand({
		id: "benchmark-create",
		name: "OCR-Messung: Notiz mit 30 Testsätzen anlegen",
		callback: () => void createBenchmark(plugin),
	});

	plugin.addCommand({
		id: "benchmark-evaluate",
		name: "OCR-Messung auswerten",
		editorCallback: (editor, ctx) => {
			if (ctx.file) void evaluateBenchmark(plugin, editor, ctx.file);
		},
	});

	plugin.addCommand({
		id: "ocr-debug",
		name: "OCR-Debug: Segmentbilder dieser Notiz speichern",
		editorCallback: (editor, ctx) => {
			if (ctx.file) void saveSegmentImages(plugin, ctx.file, editor.getValue());
		},
	});

	plugin.addCommand({
		id: "training-dictation",
		name: "Schreibtraining: Diktat",
		callback: () => new DictationModal(plugin).open(),
	});

	plugin.addCommand({
		id: "training-letters",
		name: "Schreibtraining: Buchstaben für Wortvorschläge",
		callback: () => new DictationModal(plugin, true).open(),
	});

	plugin.addCommand({
		id: "training-review-note",
		name: "Schreibtraining: Erkennung dieser Notiz überprüfen",
		editorCallback: (editor, ctx) => {
			if (ctx.file) openReview(plugin, noteSources(ctx.file.path, editor.getValue()));
		},
	});

	plugin.addCommand({
		id: "training-review-recent",
		name: "Schreibtraining: Unsichere Wörter der letzten Schreibflächen überprüfen",
		callback: async () => openReview(plugin, await recentSources(plugin)),
	});

	plugin.addCommand({
		id: "training-tune",
		name: "Schreibtraining: Erkennung auf meine Schrift abstimmen",
		callback: () => void runTuning(plugin),
	});

	// Auf dem Tablet gibt es keine Tastenkürzel – das Training auch über die Seitenleiste.
	plugin.addRibbonIcon("graduation-cap", "Schreibtraining", (e) => trainingMenu(plugin).showAtMouseEvent(e));

	plugin.addCommand({
		id: "pen-diagnostics",
		name: "Pen diagnostics",
		callback: () => new PenDiagnosticsModal(plugin.app).open(),
	});
}

function freeInkPath(plugin: InkBlocksPlugin, noteBasename: string): { path: string; id: string } {
	for (;;) {
		const id = shortId();
		const path = normalizePath(`${plugin.settings.folder}/${inkFileName(new Date(), noteBasename, id)}`);
		if (!plugin.app.vault.getAbstractFileByPath(path)) return { path, id };
	}
}

/** Fügt den Block als eigenen Absatz (mit Leerzeilen davor/danach) an der Cursorposition ein. */
export function insertBlockAtCursor(editor: Editor, body: string) {
	const block = "```ink\n" + body + "\n```";
	const { line } = editor.getCursor();
	const current = editor.getLine(line);
	const filled = (n: number) => n >= 0 && n < editor.lineCount() && editor.getLine(n).trim() !== "";

	let text: string;
	let firstLine: number;
	if (current.trim() === "") {
		const before = filled(line - 1) ? "\n" : "";
		text = before + block + (filled(line + 1) ? "\n" : "");
		editor.replaceRange(text, { line, ch: 0 }, { line, ch: current.length });
		firstLine = line + before.length;
	} else {
		text = "\n\n" + block + (filled(line + 1) ? "\n" : "");
		editor.replaceRange(text, { line, ch: current.length });
		firstLine = line + 2;
	}
	const closing = firstLine + block.split("\n").length - 1;
	editor.setCursor({ line: Math.min(closing + 1, editor.lineCount() - 1), ch: 0 });
}

async function insertNotebook(plugin: InkBlocksPlugin, editor: Editor, ctx: MarkdownView | MarkdownFileInfo) {
	const note = ctx.file;
	if (!note) return;
	const { path, id } = freeInkPath(plugin, note.basename);
	try {
		await plugin.store.create(path, createNotebook(id));
	} catch (e) {
		new Notice(`Schreibfläche konnte nicht angelegt werden: ${String(e)}`);
		return;
	}
	insertBlockAtCursor(editor, `file: ${path}`);
}

async function pickPages(plugin: InkBlocksPlugin, editor: Editor, note: TFile, file: TFile) {
	const pages = await choosePages(plugin, file);
	if (pages) await insertWorksheet(plugin, editor, note, file, pages);
}

/**
 * Seiten für ein Arbeitsblatt bestimmen: Bild → eine Fläche; PDF mit fester Seite → diese; einseitiges
 * PDF → Seite 1; sonst Auswahl (eine Seite oder alle). `null` = abgebrochen/nicht lesbar.
 */
export async function choosePages(plugin: InkBlocksPlugin, file: TFile, page?: number): Promise<(number | undefined)[] | null> {
	if (backgroundKind(file) !== "pdf") return [undefined];
	if (page) return [page];
	let count: number;
	try {
		count = (await openPdf(plugin.app, file)).numPages;
	} catch {
		new Notice(`PDF nicht lesbar: ${file.path}`);
		return null;
	}
	if (count === 1) return [1];
	return new Promise((resolve) => new WorksheetPageModal(plugin.app, count, resolve, () => resolve(null)).open());
}

/** Legt je Seite eine Arbeitsblatt-Fläche an und liefert die Block-Inhalte (file: + bg:). */
export async function createWorksheetBodies(
	plugin: InkBlocksPlugin,
	note: TFile,
	file: TFile,
	pages: (number | undefined)[],
): Promise<string[]> {
	const linktext = plugin.app.metadataCache.fileToLinktext(file, note.path, false);
	const bodies: string[] = [];
	for (const page of pages) {
		const bg = await measureBackground(plugin.app, file, page);
		const { path, id } = freeInkPath(plugin, `${note.basename} ${file.basename}${page ? ` s${page}` : ""}`);
		await plugin.store.create(path, createPage(id, bg));
		bodies.push(setField(`file: ${path}`, "bg", formatBgLink(linktext, page)));
	}
	return bodies;
}

/** Legt je Seite eine Arbeitsblatt-Fläche an und fügt die Blöcke untereinander ein. */
export async function insertWorksheet(
	plugin: InkBlocksPlugin,
	editor: Editor,
	note: TFile,
	file: TFile,
	pages: (number | undefined)[],
) {
	try {
		for (const body of await createWorksheetBodies(plugin, note, file, pages)) insertBlockAtCursor(editor, body);
	} catch (e) {
		new Notice(`Arbeitsblatt konnte nicht angelegt werden: ${(e as Error).message}`);
	}
}

/** Alle ink-Blöcke einer Notiz sofort erkennen (überschreibt auch bearbeiteten Text). */
async function recognizeNote(plugin: InkBlocksPlugin, notePath: string, text: string, quiet = false): Promise<boolean> {
	const fences = findInkFences(text).filter((f) => f.file);
	let written = 0;
	for (const fence of fences) {
		const inkPath = normalizePath(fence.file!);
		const listener = () => {};
		const entry = await plugin.store.acquire(inkPath, listener).catch(() => null);
		if (!entry) continue;
		try {
			const outcome = await plugin.ocr.run(
				{ entry, inkPath, notePath, hint: () => fence.open, busy: () => false },
				true,
			);
			if (outcome === "written") written++;
			else if (outcome === "no-models") return false;
		} finally {
			plugin.store.release(entry, listener);
		}
	}
	if (!quiet) new Notice(`Handschrift erkannt: ${fences.length} Block/Blöcke, ${written} aktualisiert.`);
	return true;
}

/** .ink-Dateien, die in keinem ink-Block einer Notiz vorkommen. */
export async function findOrphans(plugin: InkBlocksPlugin): Promise<TFile[]> {
	const { vault } = plugin.app;
	const used = new Set<string>();
	for (const note of vault.getMarkdownFiles()) {
		const text = await vault.cachedRead(note);
		if (!text.includes("ink")) continue;
		for (const fence of findInkFences(text)) if (fence.file) used.add(normalizePath(fence.file));
	}
	return vault.getFiles().filter((f) => f.extension === "ink" && !used.has(f.path));
}

async function createBenchmark(plugin: InkBlocksPlugin) {
	const date = new Date().toISOString().slice(0, 10);
	let notePath = `Ink OCR-Messung ${date}.md`;
	for (let i = 2; plugin.app.vault.getAbstractFileByPath(notePath); i++) notePath = `Ink OCR-Messung ${date} (${i}).md`;
	const paths: string[] = [];
	for (let i = 0; i < 30; i++) {
		const { path, id } = freeInkPath(plugin, `ocr-messung ${i + 1}`);
		await plugin.store.create(path, createNotebook(id, 220));
		paths.push(path);
	}
	const file = await plugin.app.vault.create(notePath, benchmarkNote(paths, date));
	await plugin.app.workspace.getLeaf(true).openFile(file);
}

async function evaluateBenchmark(plugin: InkBlocksPlugin, editor: Editor, note: TFile) {
	if (!(await recognizeNote(plugin, note.path, editor.getValue(), true))) return;
	const text = editor.getValue();
	const fences = findInkFences(text);
	const items = parseBenchmark(text, fences);
	if (!items.length) {
		new Notice("Keine OCR-Messung in dieser Notiz gefunden.");
		return;
	}
	const rows = items.map((item) => ({
		n: item.n,
		prompt: item.prompt,
		recognized: parseBlock(fences.find((f) => f.open === item.line)?.body ?? "").text?.trim() ?? "",
	}));
	const engines = new Set<string>();
	const listener = () => {};
	for (const item of items) {
		const entry = await plugin.store.acquire(item.inkPath, listener).catch(() => null);
		if (!entry) continue;
		if (entry.doc.ocr && entry.doc.strokes.length) engines.add(entry.doc.ocr.engine);
		plugin.store.release(entry, listener);
	}
	const report = benchmarkReport(rows, [...engines].join(", ") || "–", new Date().toLocaleString());
	const updated = upsertReport(text, report);
	// Nur den geänderten Bereich ersetzen (Undo-fähig, Cursor bleibt)
	let start = 0;
	while (start < text.length && text[start] === updated[start]) start++;
	editor.replaceRange(updated.slice(start), editor.offsetToPos(start), editor.offsetToPos(text.length));
	new Notice("OCR-Messung ausgewertet – Ergebnis am Ende der Notiz.");
}

/**
 * Speichert für jeden ink-Block die Segmentbilder (so wie das Modell sie sieht) und den erkannten Text
 * nach `<Ordner>/_debug/` und legt eine Übersichtsnotiz an – zum Nachvollziehen von Erkennungsfehlern.
 */
async function saveSegmentImages(plugin: InkBlocksPlugin, note: TFile, text: string) {
	const { vault } = plugin.app;
	const dir = normalizePath(`${plugin.settings.folder}/_debug`);
	if (!vault.getFolderByPath(dir)) await vault.createFolder(dir);
	const md = [`# OCR-Debug: ${note.basename}`, ""];
	const listener = () => {};
	for (const fence of findInkFences(text)) {
		if (!fence.file) continue;
		const entry = await plugin.store.acquire(normalizePath(fence.file), listener).catch(() => null);
		if (!entry) continue;
		const pen = entry.doc.strokes.filter((s) => s.tool === "pen");
		const refHeight = referenceHeight(pen);
		md.push(`## ${fence.file}`, "", `Referenzhöhe: ${refHeight.toFixed(1)} · Engine: ${entry.doc.ocr?.engine ?? "–"}`, "");
		let n = 0;
		for (const [li, line] of segmentLines(entry.doc.strokes).entries()) {
			for (const seg of line) {
				const { canvas } = rasterizeSegment({ strokes: seg.strokes.map((s) => s.points), box: seg.box, refHeight, raster: plugin.ocr.raster }, 64, 1024).canvases[0];
				const png = await (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer();
				const name = `${entry.doc.id}-${++n}.png`;
				const path = `${dir}/${name}`;
				const existing = vault.getFileByPath(path);
				if (existing) await vault.modifyBinary(existing, png);
				else await vault.createBinary(path, png);
				md.push(`Zeile ${li + 1}: \`${entry.doc.ocr?.lines[seg.key] ?? "?"}\``, "", `![[${path}]]`, "");
			}
		}
		plugin.store.release(entry, listener);
	}
	const target = `${dir}/OCR-Debug ${note.basename}.md`;
	const file = vault.getFileByPath(target);
	if (file) await vault.modify(file, md.join("\n"));
	await plugin.app.workspace.getLeaf(true).openFile(file ?? (await vault.create(target, md.join("\n"))));
}

/** Menü des Schreibtrainings (Seitenleiste, Einstellungen). */
export function trainingMenu(plugin: InkBlocksPlugin): Menu {
	const menu = new Menu();
	menu.addItem((i) => i.setTitle("Diktat").setIcon("pencil-line").onClick(() => new DictationModal(plugin).open()));
	menu.addItem((i) => i.setTitle("Buchstaben für Wortvorschläge").setIcon("sparkles").onClick(() => new DictationModal(plugin, true).open()));
	const file = plugin.app.workspace.getActiveFile();
	if (file?.extension === "md") {
		menu.addItem((i) =>
			i
				.setTitle("Erkennung dieser Notiz überprüfen")
				.setIcon("file-check")
				.onClick(async () => openReview(plugin, noteSources(file.path, await plugin.app.vault.cachedRead(file)))),
		);
	}
	menu.addItem((i) => i.setTitle("Unsichere Wörter der letzten Flächen").setIcon("list-checks").onClick(async () => openReview(plugin, await recentSources(plugin))));
	menu.addItem((i) => i.setTitle("Auf meine Schrift abstimmen").setIcon("sliders-horizontal").onClick(() => void runTuning(plugin)));
	return menu;
}

function openReview(plugin: InkBlocksPlugin, sources: ReviewSource[]) {
	if (!sources.length) {
		new Notice("Keine Schreibflächen gefunden.");
		return;
	}
	new ReviewModal(plugin, sources).open();
}

/** ink-Blöcke einer Notiz. */
function noteSources(notePath: string, text: string): ReviewSource[] {
	return findInkFences(text)
		.filter((f) => f.file)
		.map((f) => ({ inkPath: normalizePath(f.file!), notePath, line: f.open }));
}

/** Zuletzt geänderte Schreibflächen (höchstens so viele) samt der Notiz, in der ihr Block steht. */
const RECENT_LIMIT = 25;

async function recentSources(plugin: InkBlocksPlugin): Promise<ReviewSource[]> {
	const { vault } = plugin.app;
	const inks = vault
		.getFiles()
		.filter((f) => f.extension === "ink")
		.sort((a, b) => b.stat.mtime - a.stat.mtime)
		.slice(0, RECENT_LIMIT);
	const where = new Map<string, { notePath: string; line: number }>();
	for (const note of vault.getMarkdownFiles()) {
		const text = await vault.cachedRead(note);
		if (!text.includes("ink")) continue;
		for (const f of findInkFences(text)) if (f.file && !where.has(normalizePath(f.file))) where.set(normalizePath(f.file), { notePath: note.path, line: f.open });
	}
	return inks.map((f) => ({ inkPath: f.path, notePath: where.get(f.path)?.notePath ?? null, line: where.get(f.path)?.line }));
}
