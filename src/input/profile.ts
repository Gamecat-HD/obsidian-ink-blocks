/**
 * Eingabeprofil je Gerät: Wer zeichnet – der Stift (Finger scrollen) oder der Finger (zwei Finger scrollen)?
 * Liegt in `localStorage`, nicht in `data.json`: Laptop mit Stift und Android-Tablet ohne aktiven Stift
 * brauchen verschiedene Werte, `data.json` kann aber über den Sync geteilt sein.
 */

import { readLocal as read, writeLocal as write } from "../util/local";

export type InputProfile = "auto" | "pen" | "finger";

const PROFILE_KEY = "ink-blocks-input-profile";
/** Auf diesem Gerät wurde schon einmal ein echter Stift (`pointerType: "pen"`) benutzt. */
const PEN_SEEN_KEY = "ink-blocks-pen-seen";

/** Berührungen mit größerer Kontaktfläche (CSS-px) sind im Finger-Profil ein Handballen, kein Finger. */
export const PALM_CONTACT_PX = 40;

export const PROFILE_LABELS: Record<InputProfile, string> = {
	auto: "Automatisch",
	pen: "Stift zeichnet, Finger scrollen",
	finger: "Finger zeichnen, zwei Finger scrollen",
};

export function storedProfile(): InputProfile {
	const v = read(PROFILE_KEY);
	return v === "pen" || v === "finger" ? v : "auto";
}

export function setStoredProfile(profile: InputProfile) {
	write(PROFILE_KEY, profile === "auto" ? null : profile);
}

export function penSeen(): boolean {
	return read(PEN_SEEN_KEY) === "1";
}

/** Merkt sich den ersten Stiftkontakt; `true`, wenn es der erste war. */
export function markPenSeen(): boolean {
	if (penSeen()) return false;
	write(PEN_SEEN_KEY, "1");
	return true;
}

export function forgetPen() {
	write(PEN_SEEN_KEY, null);
}

/**
 * Zeichnet nur der Stift? Automatisch: Stift schon gesehen → ja; Mobilgerät ohne Stift → nein (Finger bzw.
 * passiver Stift, der sich als Finger meldet); Desktop → die alte Einstellung „Nur Stift zeichnet“.
 */
export function resolvePenOnly(profile: InputProfile, seen: boolean, mobile: boolean, legacyPenOnly: boolean): boolean {
	if (profile === "pen") return true;
	if (profile === "finger") return false;
	if (seen) return true;
	return mobile ? false : legacyPenOnly;
}

/** Kontaktfläche eines Pointers (CSS-px) – groß = Handballen. */
export function isPalmContact(width: number, height: number): boolean {
	return Math.max(width || 0, height || 0) > PALM_CONTACT_PX;
}
