import { MarkdownView, type App, type Editor } from "obsidian";
import { locateInkFence, replaceFenceBody } from "./locate";
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

/** Liest ein Feld des Blocks aus der aktuellen Fassung der Notiz (offener Editor oder Datei). */
export async function readBlockField(
	app: App,
	notePath: string,
	inkPath: string,
	key: string,
	hintLine?: number,
): Promise<string | undefined | null> {
	const editor = openEditor(app, notePath);
	let text: string;
	if (editor) text = editor.getValue();
	else {
		const file = app.vault.getFileByPath(notePath);
		if (!file) return null;
		text = await app.vault.cachedRead(file);
	}
	const found = locateInkFence(text, inkPath, hintLine);
	return found ? parseBlock(found.fence.body)[key] : null;
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
