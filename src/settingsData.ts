import type { EngineId } from "./ocr/models";
import type { BgStyle } from "./model/pattern";
import { isInkColor, type InkColor } from "./model/ink-format";

export type ToolId = "pen" | "hl" | "tape" | "eraser" | "lasso";
/** Breiten-Slot: 0 = fein, 1 = mittel, 2 = breit. */
export type WidthSlot = 0 | 1 | 2;
export type WidthSizes = [number, number, number];

/** Zustand der Werkzeugleiste – gilt für alle Blöcke. */
export interface ToolState {
	tool: ToolId;
	/** Palettenindex für Stift bzw. Textmarker (siehe PEN_COLORS/HL_COLORS). */
	penColor: InkColor;
	hlColor: InkColor;
	penWidth: WidthSlot;
	hlWidth: WidthSlot;
	eraserWidth: WidthSlot;
	tapeColor: InkColor;
	tapeWidth: WidthSlot;
}

export type ColorKind = "pen" | "hl" | "tape";
export const MAX_CUSTOM_COLORS = 4;

/** Radierer: ganze Striche entfernen oder nur die berührten Stellen (Striche werden geteilt). */
export type EraserMode = "stroke" | "precise";
/** Radius des Radierers je Breiten-Slot (Doc-Einheiten). */
export const ERASER_SIZES: WidthSizes = [5, 10, 20];

export interface InkSettings {
	/** Ordner für die .ink-Dateien, relativ zum Vault. */
	folder: string;
	/** Hintergrund neuer Schreibflächen im Heft-Modus. */
	bgStyle: BgStyle;
	/** Linienabstand (liniert) bzw. Kästchengröße (kariert) in Doc-Einheiten (1000 = Blockbreite). */
	ruledGap: number;
	gridGap: number;
	/** Strichbreiten der drei Slots in Doc-Einheiten. */
	penSizes: WidthSizes;
	hlSizes: WidthSizes;
	/** Textmarker zieht gerade Linien (Lineal), nahe der Waagerechten exakt waagerecht. */
	hlStraight: boolean;
	/** Strich kurz halten → Linie, Rechteck, Dreieck oder Ellipse/Kreis. */
	shapeRecognition: boolean;
	/** Finger zeichnen nicht, sondern scrollen (Stift und Maus zeichnen). */
	penOnly: boolean;
	/** Maus zeichnet. */
	mouseDraws: boolean;
	/** Seitentaste des Stifts radiert (zusätzlich zum Radierer-Ende). */
	barrelErases: boolean;
	eraserMode: EraserMode;
	/** Radierer trifft nur Textmarker – die Schrift darunter bleibt. */
	eraseHlOnly: boolean;
	tools: ToolState;
	/** Eigene Farben je Werkzeug (zuletzt gewählte zuerst, höchstens MAX_CUSTOM_COLORS). */
	customColors: Record<ColorKind, string[]>;
	/** Handschrift lokal erkennen und ins `text:`-Feld schreiben. */
	ocrEnabled: boolean;
	/** Ruhepause nach dem letzten Strich, bevor erkannt wird (Sekunden). */
	ocrDelay: number;
	/** „auto“ = de-htr-web-v2 → v1 → Tesseract.js, je nachdem was geladen ist und funktioniert. */
	ocrEngine: "auto" | EngineId;
	/** Beam-Search mit Zeichen-Sprachmodell aus dem Vault statt Greedy (nur de-htr-web). */
	ocrLanguageModel: boolean;
	/** Zusätzliche Fachbegriffe für das Sprachmodell (Zeilen, Komma oder Semikolon getrennt). */
	ocrHotwords: string;
	/** Erkannten Text dezent unter dem Block anzeigen. */
	showText: boolean;
}

export const DEFAULT_SETTINGS: InkSettings = {
	folder: "_ink",
	bgStyle: "ruled",
	ruledGap: 40,
	gridGap: 25,
	penSizes: [2.6, 4.6, 7],
	hlSizes: [16, 28, 40],
	hlStraight: true,
	shapeRecognition: true,
	penOnly: true,
	mouseDraws: true,
	barrelErases: true,
	eraserMode: "stroke",
	eraseHlOnly: false,
	customColors: { pen: [], hl: [], tape: [] },
	tools: { tool: "pen", penColor: 0, hlColor: 3, penWidth: 0, hlWidth: 0, eraserWidth: 1, tapeColor: 6, tapeWidth: 0 },
	ocrEnabled: true,
	ocrDelay: 10,
	ocrEngine: "auto",
	ocrLanguageModel: true,
	ocrHotwords: "",
	showText: true,
};

/** Grenzen der Einstellungs-Regler (Doc-Einheiten). */
export const LIMITS = {
	ruledGap: [20, 80],
	gridGap: [10, 50],
	penSize: [1, 14],
	hlSize: [6, 60],
} as const;

const clamp = (v: number, [lo, hi]: readonly [number, number]) => Math.min(hi, Math.max(lo, v));
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function sizes(raw: unknown, fallback: WidthSizes, limits: readonly [number, number]): WidthSizes {
	if (!Array.isArray(raw) || raw.length !== 3 || !raw.every(isNum)) return [...fallback];
	return raw.map((v) => clamp(v, limits)) as WidthSizes;
}

function slot(raw: unknown): WidthSlot {
	return raw === 1 || raw === 2 ? raw : 0;
}

/** Gespeicherte Daten (ggf. aus älteren Versionen) mit den Defaults zusammenführen und prüfen. */
export function normalizeSettings(data: Partial<InkSettings> | null | undefined): InkSettings {
	const raw = data ?? {};
	const d = DEFAULT_SETTINGS;
	const settings: InkSettings = { ...d, ...raw, tools: { ...d.tools, ...raw.tools } };
	settings.ruledGap = isNum(raw.ruledGap) ? clamp(raw.ruledGap, LIMITS.ruledGap) : d.ruledGap;
	settings.gridGap = isNum(raw.gridGap) ? clamp(raw.gridGap, LIMITS.gridGap) : d.gridGap;
	settings.penSizes = sizes(raw.penSizes, d.penSizes, LIMITS.penSize);
	settings.hlSizes = sizes(raw.hlSizes, d.hlSizes, LIMITS.hlSize);
	settings.tools.penWidth = slot(settings.tools.penWidth);
	settings.tools.hlWidth = slot(settings.tools.hlWidth);
	settings.tools.eraserWidth = raw.tools?.eraserWidth === undefined ? d.tools.eraserWidth : slot(settings.tools.eraserWidth);
	settings.tools.tapeWidth = slot(settings.tools.tapeWidth);
	for (const k of ["penColor", "hlColor", "tapeColor"] as const) if (!isInkColor(settings.tools[k])) settings.tools[k] = d.tools[k];
	const custom = (raw.customColors ?? {}) as Partial<Record<ColorKind, unknown>>;
	settings.customColors = { pen: [], hl: [], tape: [] };
	for (const k of ["pen", "hl", "tape"] as const) {
		const list = Array.isArray(custom[k]) ? custom[k] : [];
		settings.customColors[k] = list.filter((c): c is string => typeof c === "string" && isInkColor(c)).slice(0, MAX_CUSTOM_COLORS);
	}
	if (settings.eraserMode !== "precise") settings.eraserMode = "stroke";
	if (typeof settings.ocrHotwords !== "string") settings.ocrHotwords = d.ocrHotwords;
	return settings;
}
