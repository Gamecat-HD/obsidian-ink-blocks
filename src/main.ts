import { debounce, getIconIds, loadPdfJs, Notice, Platform, Plugin, TFile, type TAbstractFile } from "obsidian";
import { InkBlockChild } from "./block/InkBlockChild";
import type { InkEditor } from "./block/InkEditor";
import { registerCommands } from "./commands";
import { markPenSeen, penSeen, resolvePenOnly, storedProfile } from "./input/profile";
import type { InkClipboard } from "./input/Selection";
import { OcrService } from "./ocr/OcrService";
import { rasterizeSegment } from "./ocr/raster";
import { referenceHeight, segmentLines } from "./ocr/segment";

/** Für Messskripte (scripts/bench/real.mjs): Segmentierung und Rasterung ohne Worker. */
const ocrInternals = { segmentLines, referenceHeight, rasterizeSegment };
import { EmbedAnnotator } from "./ui/EmbedAnnotator";
import { registerTabletMode } from "./ui/TabletMode";
import { InkSettingTab, normalizeSettings, type InkSettings } from "./settings";
import { InkStore, type InkEntry } from "./store/InkStore";
import { SampleStore } from "./training/SampleStore";
import { runTuning } from "./training/runTuning";

export default class InkBlocksPlugin extends Plugin {
	declare settings: InkSettings;
	store!: InkStore;
	ocr!: OcrService;
	/** Proben des Schreibtrainings */
	training!: SampleStore;
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
		ocr: typeof ocrInternals;
		training: { runTuning: typeof runTuning };
	} = {
		loadPdfJs,
		getIconIds,
		ocr: ocrInternals,
		training: { runTuning },
		loaded: 0,
		unloaded: 0,
	};

	async onload() {
		await this.loadSettings();
		this.store = new InkStore(this);
		this.training = new SampleStore(this);
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

	/** Zeichnet auf diesem Gerät nur der Stift (Finger scrollen)? Siehe input/profile.ts. */
	get penOnly(): boolean {
		return resolvePenOnly(storedProfile(), penSeen(), Platform.isMobileApp, this.settings.penOnly);
	}

	/** Erster Stiftkontakt auf diesem Gerät: schaltet „Automatisch“ von Finger auf Stift um. */
	penDetected() {
		const before = this.penOnly;
		if (!markPenSeen() || before === this.penOnly) return;
		new Notice("Stift erkannt: Ab jetzt schreibt nur der Stift, Finger scrollen. Ändern unter Einstellungen → Ink Blocks → Eingabe.", 8000);
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

	/** Erkennungs-Hinweis unter den Blöcken einer Datei neu zeichnen (z. B. „neuere Erkennung liegt bereit“). */
	refreshCaptions(entry: InkEntry) {
		for (const block of this.blocks) if (block.entryRef === entry) block.renderCaption();
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
