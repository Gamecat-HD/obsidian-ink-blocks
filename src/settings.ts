import { normalizePath, PluginSettingTab, Setting } from "obsidian";
import type InkBlocksPlugin from "./main";

export type BgStyle = "ruled" | "grid" | "blank";

export interface InkSettings {
	/** Ordner für die .ink-Dateien, relativ zum Vault. */
	folder: string;
	/** Hintergrund neuer Schreibflächen im Heft-Modus. */
	bgStyle: BgStyle;
}

export const DEFAULT_SETTINGS: InkSettings = {
	folder: "_ink",
	bgStyle: "ruled",
};

export class InkSettingTab extends PluginSettingTab {
	constructor(private readonly plugin: InkBlocksPlugin) {
		super(plugin.app, plugin);
	}

	display() {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Ordner für Ink-Dateien")
			.setDesc("Hier landen die .ink-Dateien neuer Schreibflächen. Bestehende Dateien werden nicht verschoben.")
			.addText((text) =>
				text
					.setPlaceholder(DEFAULT_SETTINGS.folder)
					.setValue(this.plugin.settings.folder)
					.onChange(async (value) => {
						this.plugin.settings.folder = normalizePath(value.trim() || DEFAULT_SETTINGS.folder);
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Standard-Hintergrund")
			.setDesc("Für Schreibflächen ohne eigenes bgStyle.")
			.addDropdown((dd) =>
				dd
					.addOptions({ ruled: "Liniert", grid: "Kariert", blank: "Leer" })
					.setValue(this.plugin.settings.bgStyle)
					.onChange(async (value) => {
						this.plugin.settings.bgStyle = value as BgStyle;
						await this.plugin.saveSettings();
					}),
			);
	}
}
