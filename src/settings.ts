import { normalizePath, Notice, PluginSettingTab, Setting } from "obsidian";
import type InkBlocksPlugin from "./main";
import { ENGINE_ORDER, ENGINES, engineFiles, type EngineId } from "./ocr/models";
import type { BgStyle } from "./model/pattern";
import { DEFAULT_SETTINGS, LIMITS, type InkSettings, type WidthSizes } from "./settingsData";

export type { BgStyle } from "./model/pattern";
export * from "./settingsData";

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
					.addOptions({ ruled: "Liniert", grid: "Kariert", dots: "Punkteraster", blank: "Leer" })
					.setValue(this.plugin.settings.bgStyle)
					.onChange(async (value) => {
						this.plugin.settings.bgStyle = value as BgStyle;
						await this.plugin.saveSettings();
						this.plugin.refreshBlocks();
					}),
			);

		this.slider("Linienabstand (liniert)", "Abstand der Linien. Je Fläche änderbar über den Hintergrund-Knopf der Leiste.", LIMITS.ruledGap, 1,
			() => this.plugin.settings.ruledGap, (v) => (this.plugin.settings.ruledGap = v), () => this.plugin.refreshBlocks());
		this.slider("Kästchengröße (kariert, Punkteraster)", "Größe der Kästchen bzw. Abstand der Punkte. Je Fläche änderbar über den Hintergrund-Knopf der Leiste.", LIMITS.gridGap, 1,
			() => this.plugin.settings.gridGap, (v) => (this.plugin.settings.gridGap = v), () => this.plugin.refreshBlocks());

		new Setting(containerEl).setName("Strichbreiten").setDesc("Gelten für neue Striche; Vorhandenes bleibt, wie es ist.").setHeading();
		this.sizeSliders("Stift", "penSizes", LIMITS.penSize, 0.2);
		this.sizeSliders("Textmarker", "hlSizes", LIMITS.hlSize, 1);
		this.toggle("Textmarker zieht gerade Linien", "Wie mit dem Lineal: vom Ansatzpunkt gerade zum Stift, nahe der Waagerechten exakt waagerecht. Auch über den Lineal-Knopf in der Leiste umschaltbar.", "hlStraight", () => this.plugin.toolsChanged());

		new Setting(containerEl).setName("Eingabe").setHeading();
		this.toggle("Formen erkennen", "Linie, Rechteck, Dreieck oder Kreis zeichnen und am Ende den Stift kurz ruhig halten – daraus wird eine saubere Form.", "shapeRecognition");
		this.toggle("Nur Stift zeichnet", "Finger scrollen die Notiz statt zu zeichnen (Handballen werden ignoriert).", "penOnly");
		this.toggle("Maus zeichnet", "Mit gedrückter linker Maustaste schreiben.", "mouseDraws");
		this.toggle("Seitentaste radiert", "Die Taste am Stift wirkt als Radierer.", "barrelErases");

		new Setting(containerEl).setName("Texterkennung").setHeading();
		this.toggle(
			"Handschrift erkennen",
			"Erkennt die Handschrift lokal auf diesem Gerät und schreibt sie ins text:-Feld des Blocks – durchsuchbar in Obsidian und anderen Tools, die den Vault lesen.",
			"ocrEnabled",
		);
		this.toggle("Erkannten Text anzeigen", "Zeigt den erkannten Text klein unter der Schreibfläche (Klick klappt ihn auf).", "showText", () => this.plugin.refreshBlocks());
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
		new Setting(containerEl)
			.setName("Erkennungs-Engine")
			.setDesc("Automatisch: de-htr-web-v2, sonst v1, sonst Tesseract.js – je nachdem, was geladen ist und funktioniert.")
			.addDropdown((dd) =>
				dd
					.addOptions({ auto: "Automatisch", "htr-v2": ENGINES["htr-v2"].label, "htr-v1": ENGINES["htr-v1"].label, tesseract: ENGINES.tesseract.label })
					.setValue(this.plugin.settings.ocrEngine)
					.onChange(async (v) => {
						this.plugin.settings.ocrEngine = v as InkSettings["ocrEngine"];
						await this.plugin.saveSettings();
						this.plugin.ocr.reset();
					}),
			);
		this.toggle(
			"Sprachmodell aus dem Vault",
			"Liest unsichere Buchstaben im Kontext deiner Notizen (Zeichen-Sprachmodell, lokal im Erkennungs-Worker) und prüft IP-Adressen auf gültige Zeichen. Gilt für de-htr-web.",
			"ocrLanguageModel",
			() => this.plugin.ocr.reset(),
		);
		new Setting(containerEl)
			.setName("Fachbegriffe")
			.setDesc("Wörter, die oft vorkommen, aber selten richtig erkannt werden – eins pro Zeile oder mit Komma getrennt. Sie zählen im Sprachmodell stärker.")
			.addTextArea((ta) =>
				ta
					.setPlaceholder("Subnetzmaske\nVermittlungsschicht\nPrimärschlüssel")
					.setValue(this.plugin.settings.ocrHotwords)
					.onChange(async (v) => {
						this.plugin.settings.ocrHotwords = v;
						await this.plugin.saveSettings();
						this.plugin.ocr.invalidateCorpus();
					}),
			);
		for (const id of ENGINE_ORDER) this.modelSetting(containerEl, id);
	}

	private modelSetting(containerEl: HTMLElement, id: EngineId) {
		const spec = ENGINES[id];
		const mb = (engineFiles(spec).reduce((n, f) => n + f.size, 0) / 1e6).toFixed(0);
		const setting = new Setting(containerEl).setName(spec.label).setDesc("Wird geprüft …");
		setting.settingEl.addClass("ink-model-setting");
		void this.plugin.ocr.models.isReady(spec).then((ready) => {
			if (ready) {
				setting.setDesc("Bereit – läuft komplett offline.");
				return;
			}
			const hint = id === "htr-v2" ? "Empfohlen. " : "Optional (Ausweich-Engine). ";
			setting.setDesc(`${hint}Einmaliger Download (~${mb} MB) in den Plugin-Ordner, danach offline. Es werden keine Notizen oder Handschriften übertragen.`);
			setting.addButton((b) =>
				b
					.setButtonText("Herunterladen")
					.then((btn) => id === "htr-v2" && btn.setCta())
					.onClick(async () => {
						b.setDisabled(true);
						try {
							await this.plugin.ocr.models.download(spec, (f, i, n) => b.setButtonText(`${i + 1}/${n}: ${f.path.split("/").pop()}`));
							this.plugin.ocr.reset();
							new Notice(`${spec.label} bereit.`);
						} catch (e) {
							new Notice(`Download fehlgeschlagen: ${(e as Error).message}`, 10000);
						}
						this.display();
					}),
			);
		});
	}

	private sizeSliders(label: string, key: "penSizes" | "hlSizes", limits: readonly [number, number], step: number) {
		(["fein", "mittel", "breit"] as const).forEach((name, i) => {
			this.slider(`${label} ${name}`, "", limits, step,
				() => this.plugin.settings[key][i],
				(v) => {
					const sizes: WidthSizes = [...this.plugin.settings[key]];
					sizes[i] = v;
					this.plugin.settings[key] = sizes;
				});
		});
	}

	private slider(
		name: string,
		desc: string,
		[min, max]: readonly [number, number],
		step: number,
		get: () => number,
		set: (v: number) => void,
		after?: () => void,
	) {
		new Setting(this.containerEl)
			.setName(name)
			.setDesc(desc)
			.addSlider((sl) =>
				sl
					.setLimits(min, max, step)
					.setValue(get())
					.setDynamicTooltip()
					.onChange(async (v) => {
						set(v);
						await this.plugin.saveSettings();
						after?.();
					}),
			);
	}

	private toggle(
		name: string,
		desc: string,
		key: "penOnly" | "mouseDraws" | "barrelErases" | "ocrEnabled" | "ocrLanguageModel" | "showText" | "hlStraight" | "shapeRecognition",
		after?: () => void,
	) {
		new Setting(this.containerEl)
			.setName(name)
			.setDesc(desc)
			.addToggle((t) =>
				t.setValue(this.plugin.settings[key]).onChange(async (value) => {
					this.plugin.settings[key] = value;
					await this.plugin.saveSettings();
					after?.();
				}),
			);
	}
}
