import { normalizePath, PluginSettingTab, Setting } from "obsidian";
import type InkBlocksPlugin from "./main";

export type BgStyle = "ruled" | "grid" | "blank";
export type ToolId = "pen" | "hl" | "eraser";

/** Zustand der Werkzeugleiste – gilt für alle Blöcke. */
export interface ToolState {
	tool: ToolId;
	/** Palettenindex für Stift (0–2) bzw. Textmarker (3–5). */
	penColor: number;
	hlColor: number;
	/** 0 = fein, 1 = breit */
	penWidth: 0 | 1;
	hlWidth: 0 | 1;
}

export interface InkSettings {
	/** Ordner für die .ink-Dateien, relativ zum Vault. */
	folder: string;
	/** Hintergrund neuer Schreibflächen im Heft-Modus. */
	bgStyle: BgStyle;
	/** Finger zeichnen nicht, sondern scrollen (Stift und Maus zeichnen). */
	penOnly: boolean;
	/** Maus zeichnet. */
	mouseDraws: boolean;
	/** Seitentaste des Stifts radiert (zusätzlich zum Radierer-Ende). */
	barrelErases: boolean;
	tools: ToolState;
}

export const DEFAULT_SETTINGS: InkSettings = {
	folder: "_ink",
	bgStyle: "ruled",
	penOnly: true,
	mouseDraws: true,
	barrelErases: true,
	tools: { tool: "pen", penColor: 0, hlColor: 3, penWidth: 0, hlWidth: 0 },
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
						this.plugin.refreshBlocks();
					}),
			);

		new Setting(containerEl).setName("Eingabe").setHeading();
		this.toggle("Nur Stift zeichnet", "Finger scrollen die Notiz statt zu zeichnen (Handballen werden ignoriert).", "penOnly");
		this.toggle("Maus zeichnet", "Mit gedrückter linker Maustaste schreiben.", "mouseDraws");
		this.toggle("Seitentaste radiert", "Die Taste am Stift wirkt als Radierer.", "barrelErases");
	}

	private toggle(name: string, desc: string, key: "penOnly" | "mouseDraws" | "barrelErases") {
		new Setting(this.containerEl)
			.setName(name)
			.setDesc(desc)
			.addToggle((t) =>
				t.setValue(this.plugin.settings[key]).onChange(async (value) => {
					this.plugin.settings[key] = value;
					await this.plugin.saveSettings();
				}),
			);
	}
}
