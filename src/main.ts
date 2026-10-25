import { debounce, getIconIds, loadPdfJs, Plugin, TFile, type TAbstractFile } from "obsidian";
import { InkBlockChild } from "./block/InkBlockChild";
import type { InkEditor } from "./block/InkEditor";
import { registerCommands } from "./commands";
import type { InkClipboard } from "./input/Selection";
import { OcrService } from "./ocr/OcrService";
import { EmbedAnnotator } from "./ui/EmbedAnnotator";
import { registerTabletMode } from "./ui/TabletMode";
import { InkSettingTab, normalizeSettings, type InkSettings } from "./settings";
import { InkStore, type InkEntry } from "./store/InkStore";

export default class InkBlocksPlugin extends Plugin {
	declare settings: InkSettings;
	store!: InkStore;
	ocr!: OcrService;
	readonly blocks = new Set<InkBlockChild>();
	/** Alle offenen Zeichenansichten (Blöcke und ausgeklappte Ansicht). */
	readonly editors = new Set<InkEditor>();
	/** Lasso: kopierte Striche, für alle Blöcke. */
	clipboard: InkClipboard | null = null;
	/** Zugriff für die E2E-Tests (scripts/e2e). */
	readonly dev: {
		loadPdfJs: typeof loadPdfJs;
		getIconIds: typeof getIconIds;
		loaded: number;
		unloaded: number;
		rewriteUrl?: (url: string) => string;
	} = {
		loadPdfJs,
		getIconIds,
		loaded: 0,
		unloaded: 0,
	};

	async onload() {
		await this.loadSettings();
		this.store = new InkStore(this);
		this.ocr = new OcrService(this);

		this.registerMarkdownCodeBlockProcessor("ink", (source, el, ctx) => {
			ctx.addChild(new InkBlockChild(el, source, ctx, this));
		});
		registerCommands(this);
		new EmbedAnnotator(this);
		registerTabletMode(this);
		this.registerEvent(this.app.workspace.on("css-change", () => this.refreshBlocks()));
		// Notizen geändert → Sprachmodell der Texterkennung bei Gelegenheit neu bauen
		const notesChanged = (f: TAbstractFile) => f instanceof TFile && f.extension === "md" && this.ocr.markCorpusStale();
		this.registerEvent(this.app.vault.on("create", notesChanged));
		this.registerEvent(this.app.vault.on("modify", notesChanged));
		this.registerEvent(this.app.vault.on("delete", notesChanged));
		this.registerEvent(this.app.vault.on("rename", notesChanged));
		// Klick außerhalb des aktiven Blocks deaktiviert ihn (Strg+Z gehört dann wieder dem Editor).
		this.registerDomEvent(document, "pointerdown", (e) => {
			for (const block of this.blocks) block.deactivateUnless(e.target as Node);
		}, { capture: true });
		this.addSettingTab(new InkSettingTab(this));
	}

	onunload() {
		this.saveSoon.run();
		this.ocr.dispose();
		this.store.dispose();
	}

	async loadSettings() {
		this.settings = normalizeSettings(await this.loadData());
	}

	private readonly saveSoon = debounce(() => void this.saveSettings(), 800, true);

	/** Werkzeugzustand geändert (Toolbar): alle Leisten aktualisieren, gebündelt speichern. */
	toolsChanged() {
		// Über alle Ansichten, auch die ausgeklappte (die gehört zu keinem Block).
		for (const editor of this.editors) editor.toolsChanged();
		this.saveSoon();
	}

	/** Abdeckbänder einer Datei auf-/zugedeckt: alle Ansichten dieser Datei. */
	refreshTape(entry: InkEntry) {
		for (const editor of this.editors) {
			if (editor.entry !== entry) continue;
			editor.surface.renderTape();
			editor.toolbar.update();
		}
	}

	/** Alle sichtbaren Blöcke neu zeichnen (z. B. nach Theme- oder Einstellungswechsel). */
	refreshBlocks() {
		for (const block of this.blocks) block.refresh();
		for (const editor of this.editors) if (editor.expanded) editor.refresh();
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
