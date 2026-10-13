import type { EngineId } from "./ocr/models";
import type { BgStyle } from "./model/pattern";

export type ToolId = "pen" | "hl" | "eraser";
/** Breiten-Slot: 0 = fein, 1 = mittel, 2 = breit. */
export type WidthSlot = 0 | 1 | 2;
export type WidthSizes = [number, number, number];

/** Zustand der Werkzeugleiste – gilt für alle Blöcke. */
export interface ToolState {
	tool: ToolId;
	/** Palettenindex für Stift bzw. Textmarker (siehe PEN_COLORS/HL_COLORS). */
	penColor: number;
	hlColor: number;
	penWidth: WidthSlot;
	hlWidth: WidthSlot;
}

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
	/** „auto“ = de-htr-web-v2 → v1 → Tesseract.js, je nachdem was geladen ist und funktioniert. */
	ocrEngine: "auto" | EngineId;
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
	penOnly: true,
	mouseDraws: true,
	barrelErases: true,
	tools: { tool: "pen", penColor: 0, hlColor: 3, penWidth: 0, hlWidth: 0 },
	ocrEnabled: true,
	ocrDelay: 10,
	ocrEngine: "auto",
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
	return settings;
}
