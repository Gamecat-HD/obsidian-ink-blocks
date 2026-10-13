import { normalizePath, Notice, type Editor, type MarkdownFileInfo, type MarkdownView } from "obsidian";
import type InkBlocksPlugin from "./main";
import { PenDiagnosticsModal } from "./diagnostics";
import { createNotebook } from "./model/ink-format";
import { inkFileName, shortId } from "./util/ids";

export function registerCommands(plugin: InkBlocksPlugin) {
	plugin.addCommand({
		id: "insert-notebook",
		name: "Schreibfläche einfügen",
		editorCallback: (editor, ctx) => void insertNotebook(plugin, editor, ctx),
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
