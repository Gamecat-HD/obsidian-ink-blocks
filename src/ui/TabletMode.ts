import { MarkdownView, Notice, Platform, setIcon, setTooltip, type App } from "obsidian";
import type InkBlocksPlugin from "../main";

/**
 * iPad-Modus: schaltet Obsidian (Desktop) auf die eingebaute Mobil-/Tablet-Oberfläche um – Navigationsleiste,
 * Wischen für Seitenleisten, große Bedienelemente. Nutzt Obsidians (undokumentiertes) `app.emulateMobile`, das
 * `localStorage.EmulateMobile` setzt und neu lädt. Gilt je Gerät, wird nicht synchronisiert.
 */

/** Gleicher Schlüssel, den Obsidian beim Start prüft. */
const STORAGE_KEY = "EmulateMobile";

type EmulatingApp = App & { emulateMobile?: (on: boolean) => void };

export function isTabletMode(): boolean {
	return !!localStorage.getItem(STORAGE_KEY);
}

function available(app: App): boolean {
	return Platform.isDesktopApp && !Platform.isMobileApp && typeof (app as EmulatingApp).emulateMobile === "function";
}

export async function toggleTabletMode(plugin: InkBlocksPlugin) {
	const app = plugin.app as EmulatingApp;
	if (!available(app)) {
		new Notice("iPad-Modus gibt es nur in der Desktop-App.");
		return;
	}
	// Obsidian lädt sofort neu: vorher alles sichern (Notizen, Ink-Dateien, Einstellungen, Layout).
	await Promise.all(
		app.workspace.getLeavesOfType("markdown").map((leaf) => (leaf.view instanceof MarkdownView ? leaf.view.save() : null)),
	);
	await plugin.store.flushAll();
	await plugin.saveSettings();
	await app.workspace.requestSaveLayout.run();
	app.emulateMobile?.(!isTabletMode());
}

export function registerTabletMode(plugin: InkBlocksPlugin) {
	if (!available(plugin.app)) return;
	const on = isTabletMode();
	const label = on ? "Zurück zum Desktop-Modus" : "iPad-Modus einschalten";

	plugin.addCommand({
		id: "toggle-tablet-mode",
		name: "iPad-Modus umschalten",
		callback: () => void toggleTabletMode(plugin),
	});
	plugin.addRibbonIcon(on ? "monitor" : "tablet-smartphone", label, () => void toggleTabletMode(plugin));

	// In der Mobil-Oberfläche liegt das Ribbon im Menü – zusätzlich ein schwebender Knopf zum Zurückschalten.
	if (on) {
		const btn = document.body.createEl("button", { cls: "ink-tablet-toggle clickable-icon" });
		setIcon(btn, "monitor");
		setTooltip(btn, label);
		btn.setAttr("aria-label", label);
		btn.addEventListener("click", () => void toggleTabletMode(plugin));
		plugin.register(() => btn.remove());
	}
}
