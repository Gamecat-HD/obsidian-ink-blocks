import { normalizePath, Notice, PluginSettingTab, Setting } from "obsidian";
import { forgetPen, penSeen, PROFILE_LABELS, setStoredProfile, storedProfile, type InputProfile } from "./input/profile";
import type InkBlocksPlugin from "./main";
import { ocrLite, setOcrLite } from "./ocr/OcrService";
import { resetTuning, runTuning } from "./training/runTuning";
import { sampleStats } from "./training/samples";
import { MIN_TUNE_SAMPLES } from "./training/tuning";
import { DictationModal } from "./ui/TrainingModals";
import { ENGINE_ORDER, ENGINES, engineFiles, HTR_V1, HTR_V2, HTR_V2_FP32, type EngineId, type EngineSpec } from "./ocr/models";
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
		const profileDesc = () =>
			`Gilt nur für dieses Gerät. Automatisch: Sobald ein aktiver Stift (z. B. S Pen, Apple Pencil, HP-Stift) schreibt, zeichnet nur noch der Stift; ` +
			`auf Tablets ohne Stift zeichnen Finger bzw. passive Stifte. Gerade aktiv: ${this.plugin.penOnly ? "nur der Stift zeichnet" : "Finger zeichnen"}` +
			`${penSeen() ? " (Stift erkannt)" : ""}.`;
		const profile = new Setting(containerEl)
			.setName("Eingabe auf diesem Gerät")
			.setDesc(profileDesc())
			.addDropdown((dd) =>
				dd
					.addOptions(PROFILE_LABELS)
					.setValue(storedProfile())
					.onChange((v) => {
						setStoredProfile(v as InputProfile);
						profile.setDesc(profileDesc());
					}),
			);
		if (penSeen()) {
			profile.addExtraButton((b) =>
				b
					.setIcon("rotate-ccw")
					.setTooltip("Stift vergessen (Automatisch lässt dann wieder Finger zeichnen)")
					.onClick(() => {
						forgetPen();
						this.display();
					}),
			);
		}
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
			.setName("Sparmodus auf diesem Gerät")
			.setDesc("Nur de-htr-web-v2 in der kleinen Fassung (int8), ohne v1 als Zweitmodell: braucht etwa ein Viertel des Speichers, erkennt etwas schlechter. Auf Tablets und Handys standardmäßig an.")
			.addToggle((t) =>
				t.setValue(ocrLite()).onChange((v) => {
					setOcrLite(v);
					this.plugin.ocr.reset();
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
		this.trainingSection(containerEl);

		new Setting(containerEl).setName("Modelle").setHeading();
		const rows: [EngineSpec, string, boolean][] = [
			[HTR_V2, "Empfohlen. ", true],
			[HTR_V2_FP32, "Empfohlen: dasselbe Modell ungerechnet – 3–4× schnellere Erkennung, gleich genau. ", true],
			[HTR_V1, "Empfohlen zusätzlich: zusammen mit v2 (Einstellung „Automatisch“) gut 10 % weniger Fehler. ", true],
			[ENGINES.tesseract, "Optional (letzte Ausweich-Engine). ", false],
		];
		for (const [spec, hint, cta] of rows) this.modelSetting(containerEl, spec, hint, cta);
	}

	private trainingSection(containerEl: HTMLElement) {
		new Setting(containerEl).setName("Schreibtraining").setHeading();
		const stats = new Setting(containerEl)
			.setName("Proben")
			.setDesc("Wird gezählt …")
			.addButton((b) => b.setButtonText("Diktat").onClick(() => new DictationModal(this.plugin).open()));
		void this.plugin.training.load().then((samples) => {
			const s = sampleStats(samples);
			const cer = s.count ? ` Die Erkennung lag dabei bei ${(s.cer * 100).toFixed(1).replace(".", ",")} % Fehlern.` : "";
			stats.setDesc(
				`${s.count} Proben (${s.dictation} aus dem Diktat, ${s.review} überprüft), gespeichert in ${this.plugin.training.folder} – synchronisiert mit dem Vault.${cer} ` +
					"Überprüfen geht über die Befehle „Schreibtraining: …“ oder das Hut-Symbol in der Seitenleiste.",
			);
		});
		this.toggle("Korrekturen lernen", "Bestätigte und korrigierte Wörter fließen ins Sprachmodell – korrigierte zählen wie Fachbegriffe.", "ocrLearnCorrections", () =>
			this.plugin.ocr.invalidateCorpus(),
		);
		const t = this.plugin.settings.ocrTuned;
		const pct = (v: number) => `${(v * 100).toFixed(1).replace(".", ",")} %`;
		const tune = new Setting(containerEl)
			.setName("Auf meine Schrift abstimmen")
			.setDesc(
				t
					? `Abgestimmt am ${new Date(t.at).toLocaleDateString()} mit ${t.samples} Proben: Fehler ${pct(t.before)} → ${pct(t.after)} (v1-Anteil ${t.weight}, α ${t.alpha}, β ${t.beta}).`
					: `Sucht mit deinen Proben die besten Gewichte für Zweitmodell und Sprachmodell; übernommen wird nur, was auf zurückgehaltenen Kontrollproben nicht schlechter ist. Ab ${MIN_TUNE_SAMPLES} Proben.`,
			)
			.addButton((b) =>
				b.setButtonText("Abstimmen").onClick(async () => {
					b.setDisabled(true);
					await runTuning(this.plugin);
					this.display();
				}),
			);
		if (t) {
			tune.addExtraButton((b) =>
				b
					.setIcon("rotate-ccw")
					.setTooltip("Zurück zu den eingebauten Werten")
					.onClick(async () => {
						await resetTuning(this.plugin);
						this.display();
					}),
			);
		}
	}

	private modelSetting(containerEl: HTMLElement, spec: EngineSpec, hint: string, cta: boolean) {
		const mb = (engineFiles(spec).reduce((n, f) => n + f.size, 0) / 1e6).toFixed(0);
		const setting = new Setting(containerEl).setName(spec.label).setDesc("Wird geprüft …");
		setting.settingEl.addClass("ink-model-setting");
		void this.plugin.ocr.models.isReady(spec).then((ready) => {
			if (ready) {
				setting.setDesc("Bereit – läuft komplett offline.");
				return;
			}
			setting.setDesc(`${hint}Einmaliger Download (~${mb} MB) in den Plugin-Ordner, danach offline. Es werden keine Notizen oder Handschriften übertragen.`);
			setting.addButton((b) =>
				b
					.setButtonText("Herunterladen")
					.then((btn) => cta && btn.setCta())
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
		key: "mouseDraws" | "barrelErases" | "ocrEnabled" | "ocrLanguageModel" | "showText" | "hlStraight" | "shapeRecognition" | "ocrLearnCorrections",
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
