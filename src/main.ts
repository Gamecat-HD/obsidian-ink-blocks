import { debounce, getIconIds, loadPdfJs, Plugin } from "obsidian";
import { InkBlockChild } from "./block/InkBlockChild";
import type { InkEditor } from "./block/InkEditor";
import { registerCommands } from "./commands";
import { OcrService } from "./ocr/OcrService";
import { EmbedAnnotator } from "./ui/EmbedAnnotator";
import { registerTabletMode } from "./ui/TabletMode";
import { InkSettingTab, normalizeSettings, type InkSettings } from "./settings";
import { InkStore } from "./store/InkStore";

export default class InkBlocksPlugin extends Plugin {
	declare settings: InkSettings;
	store!: InkStore;
	ocr!: OcrService;
	readonly blocks = new Set<InkBlockChild>();
	/** Alle offenen Zeichenansichten (Blöcke und ausgeklappte Ansicht). */
	readonly editors = new Set<InkEditor>();
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
		for (const block of this.blocks) block.updateToolbar();
		this.saveSoon();
	}

	/** Alle sichtbaren Blöcke neu zeichnen (z. B. nach Theme- oder Einstellungswechsel). */
	refreshBlocks() {
		for (const block of this.blocks) block.refresh();
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
