import { normalizePath, Notice, PluginSettingTab, Setting } from "obsidian";
import type InkBlocksPlugin from "./main";
import { ENGINES, engineFiles } from "./ocr/models";

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
	/** Handschrift lokal erkennen und ins `text:`-Feld schreiben. */
	ocrEnabled: boolean;
	/** Ruhepause nach dem letzten Strich, bevor erkannt wird (Sekunden). */
	ocrDelay: number;
}

export const DEFAULT_SETTINGS: InkSettings = {
	folder: "_ink",
	bgStyle: "ruled",
	penOnly: true,
	mouseDraws: true,
	barrelErases: true,
	tools: { tool: "pen", penColor: 0, hlColor: 3, penWidth: 0, hlWidth: 0 },
	ocrEnabled: true,
	ocrDelay: 10,
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

		new Setting(containerEl).setName("Texterkennung").setHeading();
		this.toggle(
			"Handschrift erkennen",
			"Erkennt die Handschrift lokal auf diesem Gerät und schreibt sie ins text:-Feld des Blocks – durchsuchbar in Obsidian und anderen Tools, die den Vault lesen.",
			"ocrEnabled",
		);
		new Setting(containerEl)
			.setName("Wartezeit nach dem Schreiben")
			.setDesc("Sekunden Ruhe nach dem letzten Strich, bevor erkannt wird.")
			.addSlider((sl) =>
				sl
					.setLimits(2, 60, 1)
					.setValue(this.plugin.settings.ocrDelay)
					.setDynamicTooltip()
					.onChange(async (v) => {
						this.plugin.settings.ocrDelay = v;
						await this.plugin.saveSettings();
					}),
			);
		this.modelSetting(containerEl);
	}

	private modelSetting(containerEl: HTMLElement) {
		const spec = ENGINES["htr-v2"];
		const mb = (engineFiles(spec).reduce((n, f) => n + f.size, 0) / 1e6).toFixed(0);
		const setting = new Setting(containerEl)
			.setName(`Erkennungsmodell (${spec.label})`)
			.setDesc("Wird geprüft …");
		const desc = (text: string) => setting.setDesc(text);
		void this.plugin.ocr.models.isReady(spec).then((ready) => {
			if (ready) {
				desc("Bereit – läuft komplett offline.");
				return;
			}
			desc(
				`Einmaliger Download (~${mb} MB) von Hugging Face und jsDelivr in den Plugin-Ordner, danach offline. Es werden keine Notizen oder Handschriften übertragen.`,
			);
			setting.addButton((b) =>
				b
					.setButtonText("Herunterladen")
					.setCta()
					.onClick(async () => {
						b.setDisabled(true);
						try {
							await this.plugin.ocr.models.download(spec, (f, i, n) => b.setButtonText(`${i + 1}/${n}: ${f.path.split("/").pop()}`));
							new Notice("Texterkennung bereit.");
						} catch (e) {
							new Notice(`Download fehlgeschlagen: ${(e as Error).message}`, 10000);
						}
						this.display();
					}),
			);
		});
	}

	private toggle(name: string, desc: string, key: "penOnly" | "mouseDraws" | "barrelErases" | "ocrEnabled") {
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
