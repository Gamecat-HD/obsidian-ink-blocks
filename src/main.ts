import { loadPdfJs, Plugin } from "obsidian";
import { InkBlockChild } from "./block/InkBlockChild";
import { registerCommands } from "./commands";
import { DEFAULT_SETTINGS, InkSettingTab, type InkSettings } from "./settings";
import { InkStore } from "./store/InkStore";

export default class InkBlocksPlugin extends Plugin {
	declare settings: InkSettings;
	store!: InkStore;
	readonly blocks = new Set<InkBlockChild>();
	/** Zugriff für die E2E-Tests (scripts/e2e). */
	readonly dev = { loadPdfJs, loaded: 0, unloaded: 0 };

	async onload() {
		await this.loadSettings();
		this.store = new InkStore(this);

		this.registerMarkdownCodeBlockProcessor("ink", (source, el, ctx) => {
			ctx.addChild(new InkBlockChild(el, source, ctx, this));
		});
		registerCommands(this);
		this.registerEvent(this.app.workspace.on("css-change", () => this.refreshBlocks()));
		this.addSettingTab(new InkSettingTab(this));
	}

	onunload() {
		void this.store.flushAll();
	}

	async loadSettings() {
		const data = (await this.loadData()) ?? {};
		this.settings = { ...DEFAULT_SETTINGS, ...data, tools: { ...DEFAULT_SETTINGS.tools, ...data.tools } };
	}

	/** Alle sichtbaren Blöcke neu zeichnen (z. B. nach Theme- oder Einstellungswechsel). */
	refreshBlocks() {
		for (const block of this.blocks) block.refresh();
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
