import { normalizePath, Notice, type Editor, type MarkdownFileInfo, type MarkdownView, type TFile } from "obsidian";
import { formatBgLink } from "./block/bgLink";
import { findInkFences } from "./block/locate";
import { setField } from "./block/source";
import type InkBlocksPlugin from "./main";
import { PenDiagnosticsModal } from "./diagnostics";
import { createNotebook, createPage } from "./model/ink-format";
import { backgroundKind, measureBackground, openPdf } from "./render/background";
import { WorksheetFileModal, WorksheetPageModal } from "./ui/WorksheetModal";
import { ENGINES } from "./ocr/models";
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
	if (backgroundKind(file) !== "pdf") return insertWorksheet(plugin, editor, note, file, [undefined]);
	let count: number;
	try {
		count = (await openPdf(plugin.app, file)).numPages;
	} catch {
		new Notice(`PDF nicht lesbar: ${file.path}`);
		return;
	}
	if (count === 1) return insertWorksheet(plugin, editor, note, file, [1]);
	new WorksheetPageModal(plugin.app, count, (pages) => void insertWorksheet(plugin, editor, note, file, pages)).open();
}

/** Legt je Seite eine Arbeitsblatt-Fläche an und fügt die Blöcke untereinander ein. */
export async function insertWorksheet(
	plugin: InkBlocksPlugin,
	editor: Editor,
	note: TFile,
	file: TFile,
	pages: (number | undefined)[],
) {
	const linktext = plugin.app.metadataCache.fileToLinktext(file, note.path, false);
	for (const page of pages) {
		try {
			const bg = await measureBackground(plugin.app, file, page);
			const { path, id } = freeInkPath(plugin, `${note.basename} ${file.basename}${page ? ` s${page}` : ""}`);
			await plugin.store.create(path, createPage(id, bg));
			insertBlockAtCursor(editor, setField(`file: ${path}`, "bg", formatBgLink(linktext, page)));
		} catch (e) {
			new Notice(`Arbeitsblatt konnte nicht angelegt werden: ${(e as Error).message}`);
			return;
		}
	}
}

/** Alle ink-Blöcke einer Notiz sofort erkennen (überschreibt auch bearbeiteten Text). */
async function recognizeNote(plugin: InkBlocksPlugin, notePath: string, text: string) {
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
			else if (outcome === "no-models") return;
		} finally {
			plugin.store.release(entry, listener);
		}
	}
	new Notice(`Handschrift erkannt: ${fences.length} Block/Blöcke, ${written} aktualisiert.`);
}
