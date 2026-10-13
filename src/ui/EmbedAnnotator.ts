import { MarkdownView, Notice, parseLinktext, setIcon, type Editor, type TFile } from "obsidian";
import { choosePages, createWorksheetBodies } from "../commands";
import type InkBlocksPlugin from "../main";
import { backgroundKind } from "../render/background";

const EMBED_SELECTOR = ".internal-embed.image-embed, .internal-embed.pdf-embed";

const BG_EXT = /\.(pdf|png|jpe?g|webp|gif|bmp|svg|avif)$/i;

/**
 * Erstes beschriftbares `![[…]]` einer Zeile: mit `src` genau diese Einbettung, sonst die erste, deren
 * Linkziel nach Bild/PDF aussieht (eingebettete Notizen werden übersprungen).
 */
export function findEmbed(line: string, src?: string): { index: number; length: number; linktext: string } | null {
	for (const m of line.matchAll(/!\[\[([^\]|]+)(\|[^\]]*)?\]\]/g)) {
		const linktext = m[1].trim();
		const ok = src ? linktext === src.trim() : BG_EXT.test(linktext.split("#")[0]);
		if (ok) return { index: m.index ?? 0, length: m[0].length, linktext };
	}
	return null;
}

/**
 * Macht eingebettete Bilder und PDFs beschriftbar: Beim Überfahren erscheint „Beschriften“; ein Klick
 * ersetzt die Einbettung durch Arbeitsblatt-Blöcke mit dieser Datei als Hintergrund.
 */
export class EmbedAnnotator {
	constructor(private readonly plugin: InkBlocksPlugin) {
		// Embeds werden asynchron (und in Live Preview als Widgets) gerendert → Button erst beim Überfahren anhängen.
		plugin.registerDomEvent(document, "pointerover", (e) => {
			const embed = (e.target as HTMLElement | null)?.closest?.<HTMLElement>(EMBED_SELECTOR);
			if (embed) this.decorate(embed);
		});
	}

	private decorate(embed: HTMLElement) {
		if (embed.querySelector(":scope > .ink-embed-annotate") || embed.closest(".ink-block")) return;
		if (!embed.closest(".markdown-source-view, .markdown-preview-view")) return;
		const btn = embed.createEl("button", { cls: "ink-embed-annotate", attr: { "aria-label": "Mit dem Stift beschriften" } });
		setIcon(btn.createSpan(), "pencil");
		btn.createSpan({ text: "Beschriften" });
		for (const type of ["pointerdown", "mousedown"]) btn.addEventListener(type, (e) => (e.stopPropagation(), e.preventDefault()));
		btn.addEventListener("click", (e) => {
			e.stopPropagation();
			e.preventDefault();
			void this.convertElement(embed);
		});
	}

	private async convertElement(embed: HTMLElement) {
		const view = this.plugin.app.workspace
			.getLeavesOfType("markdown")
			.map((l) => l.view)
			.find((v): v is MarkdownView => v instanceof MarkdownView && v.containerEl.contains(embed));
		const src = embed.getAttribute("src");
		if (!view?.file || !src) return;
		const editor = view.editor;
		let line = -1;
		// Live Preview: Position des Widgets im Dokument; sonst erste Zeile mit dieser Einbettung.
		const cm = (editor as unknown as { cm?: { posAtDOM(n: Node): number } }).cm;
		if (view.getMode() === "source" && cm) {
			try {
				line = editor.offsetToPos(cm.posAtDOM(embed)).line;
			} catch {
				line = -1;
			}
		}
		if (line < 0 || !findEmbed(editor.getLine(line), src)) {
			line = editor.getValue().split("\n").findIndex((l) => findEmbed(l, src));
		}
		if (line < 0) {
			new Notice("Einbettung im Text nicht gefunden.");
			return;
		}
		await convertEmbedAtLine(this.plugin, editor, view.file, line, src);
	}
}

/** Ersetzt die Einbettung `src` (bzw. die erste beschriftbare) in Zeile `line` durch Arbeitsblatt-Blöcke. */
export async function convertEmbedAtLine(plugin: InkBlocksPlugin, editor: Editor, note: TFile, line: number, src?: string) {
	const found = findEmbed(editor.getLine(line), src);
	if (!found) {
		new Notice("In dieser Zeile ist kein eingebettetes Bild/PDF (![[…]]).");
		return;
	}
	const { path, subpath } = parseLinktext(found.linktext);
	const file = plugin.app.metadataCache.getFirstLinkpathDest(path, note.path);
	if (!file || !backgroundKind(file)) {
		new Notice(`Kein Bild/PDF: ${found.linktext}`);
		return;
	}
	const page = Number(/page=(\d+)/.exec(subpath)?.[1]) || undefined;
	const pages = await choosePages(plugin, file, page);
	if (!pages) return;

	let bodies: string[];
	try {
		bodies = await createWorksheetBodies(plugin, note, file, pages);
	} catch (e) {
		new Notice(`Arbeitsblatt konnte nicht angelegt werden: ${(e as Error).message}`);
		return;
	}
	// Zeile neu lesen (Dialog war offen), Einbettung durch die Blöcke ersetzen – mit Leerzeilen drumherum.
	const current = editor.getLine(line);
	const again = findEmbed(current, found.linktext);
	if (!again) return;
	const before = current.slice(0, again.index).trimEnd();
	const after = current.slice(again.index + again.length).trimStart();
	const blocks = bodies.map((b) => "```ink\n" + b + "\n```").join("\n\n");
	const filled = (n: number) => n >= 0 && n < editor.lineCount() && editor.getLine(n).trim() !== "";
	let text = [before, blocks, after].filter(Boolean).join("\n\n");
	if (!before && filled(line - 1)) text = "\n" + text;
	if (!after && filled(line + 1)) text += "\n";
	editor.replaceRange(text, { line, ch: 0 }, { line, ch: current.length });
}
