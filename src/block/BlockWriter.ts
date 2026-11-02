import { MarkdownView, normalizePath, type App, type Editor } from "obsidian";
import { fenceRemovalLines, findInkFences, locateInkFence, removeFence, replaceFenceBody } from "./locate";
import { parseBlock, setFields } from "./source";

/**
 * Schreibt ein Feld eines ```ink-Blocks zurück in die Notiz.
 * Ist die Notiz offen, über den Editor (Undo-fähig, kein Wettlauf mit dem Autosave),
 * sonst über `vault.process`. Der Block wird jeweils frisch gesucht – über `file:`, mit `hintLine`
 * als Entscheidungshilfe bei kopierten Blöcken. Gibt `false` zurück, wenn nichts geändert wurde.
 */
export async function writeBlockField(
	app: App,
	notePath: string,
	inkPath: string,
	key: string,
	value: string | undefined,
	hintLine?: number,
): Promise<boolean> {
	return writeBlockFields(app, notePath, inkPath, { [key]: value }, hintLine);
}

/** Wie `writeBlockField`, aber mehrere Felder in einem Schritt (ein Re-Render, ein Undo-Schritt). */
export async function writeBlockFields(
	app: App,
	notePath: string,
	inkPath: string,
	fields: Record<string, string | undefined>,
	hintLine?: number,
): Promise<boolean> {
	const editor = openEditor(app, notePath);
	if (editor) return writeViaEditor(editor, inkPath, fields, hintLine);

	const file = app.vault.getFileByPath(notePath);
	if (!file) return false;
	let changed = false;
	await app.vault.process(file, (data) => {
		const found = locateInkFence(data, inkPath, hintLine);
		if (!found) return data;
		const body = setFields(found.fence.body, fields);
		if (body === found.fence.body) return data;
		changed = true;
		return replaceFenceBody(data, found.fence, body);
	});
	return changed;
}

function openEditor(app: App, notePath: string): Editor | null {
	for (const leaf of app.workspace.getLeavesOfType("markdown")) {
		const view = leaf.view;
		if (view instanceof MarkdownView && view.file?.path === notePath) return view.editor;
	}
	return null;
}

function writeViaEditor(editor: Editor, inkPath: string, fields: Record<string, string | undefined>, hintLine?: number) {
	const found = locateInkFence(editor.getValue(), inkPath, hintLine);
	if (!found) return false;
	const { fence } = found;
	const body = setFields(fence.body, fields);
	if (body === fence.body) return false;
	const from = { line: fence.open + 1, ch: 0 };
	const to = { line: fence.close, ch: 0 };
	editor.replaceRange(body === "" ? "" : body.replace(/\n?$/, "\n"), from, to);
	return true;
}

/** Aktuelle Fassung der Notiz: aus dem offenen Editor (auch ungespeichert) oder aus der Datei. */
export async function readNoteText(app: App, notePath: string): Promise<string | null> {
	const editor = openEditor(app, notePath);
	if (editor) return editor.getValue();
	const file = app.vault.getFileByPath(notePath);
	return file ? app.vault.cachedRead(file) : null;
}

/** Liest ein Feld des Blocks aus der aktuellen Fassung der Notiz (offener Editor oder Datei). */
export async function readBlockField(
	app: App,
	notePath: string,
	inkPath: string,
	key: string,
	hintLine?: number,
): Promise<string | undefined | null> {
	const text = await readNoteText(app, notePath);
	if (text === null) return null;
	const found = locateInkFence(text, inkPath, hintLine);
	return found ? parseBlock(found.fence.body)[key] : null;
}

/** Wie viele ```ink-Blöcke im ganzen Vault auf `inkPath` zeigen (offene Notizen in ihrer aktuellen Fassung). */
export async function countBlocksUsing(app: App, inkPath: string): Promise<number> {
	// Vorfilter über den Dateinamen: `file:` kann anders geschrieben sein (z. B. mit führendem „/“).
	const name = inkPath.split("/").pop() ?? inkPath;
	let count = 0;
	for (const note of app.vault.getMarkdownFiles()) {
		const text = await readNoteText(app, note.path);
		if (!text?.includes(name)) continue;
		count += findInkFences(text).filter((f) => f.file && normalizePath(f.file) === inkPath).length;
	}
	return count;
}

/** Entfernt den ```ink-Block aus der Notiz (offen: über den Editor, also mit Strg+Z rückholbar). */
export async function removeBlock(app: App, notePath: string, inkPath: string, hintLine?: number): Promise<boolean> {
	const editor = openEditor(app, notePath);
	if (editor) {
		const found = locateInkFence(editor.getValue(), inkPath, hintLine);
		if (!found) return false;
		const lines = Array.from({ length: editor.lineCount() }, (_, i) => editor.getLine(i));
		const { from, to } = fenceRemovalLines(lines, found.fence);
		if (to + 1 < lines.length) editor.replaceRange("", { line: from, ch: 0 }, { line: to + 1, ch: 0 });
		else if (from > 0) editor.replaceRange("", { line: from - 1, ch: lines[from - 1].length }, { line: to, ch: lines[to].length });
		else editor.replaceRange("", { line: 0, ch: 0 }, { line: to, ch: lines[to].length });
		return true;
	}
	const file = app.vault.getFileByPath(notePath);
	if (!file) return false;
	let removed = false;
	await app.vault.process(file, (data) => {
		const found = locateInkFence(data, inkPath, hintLine);
		if (!found) return data;
		removed = true;
		return removeFence(data, found.fence);
	});
	return removed;
}

/** Text als eigenen Absatz direkt unter dem Block einfügen (Lasso → „Als Text einfügen“). */
export async function insertAfterBlock(app: App, notePath: string, inkPath: string, text: string, hintLine?: number): Promise<boolean> {
	const editor = openEditor(app, notePath);
	if (editor) {
		const found = locateInkFence(editor.getValue(), inkPath, hintLine);
		if (!found) return false;
		const line = found.fence.close;
		editor.replaceRange(`\n\n${text}`, { line, ch: editor.getLine(line).length });
		return true;
	}
	const file = app.vault.getFileByPath(notePath);
	if (!file) return false;
	let done = false;
	await app.vault.process(file, (data) => {
		const found = locateInkFence(data, inkPath, hintLine);
		if (!found) return data;
		const lines = data.split("\n");
		lines.splice(found.fence.close + 1, 0, "", text);
		done = true;
		return lines.join("\n");
	});
	return done;
}
