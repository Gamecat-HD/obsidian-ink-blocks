// M10: iPad-Modus – Ribbon-Knopf/Befehl schaltet Obsidians Mobil-Oberfläche ein (Neuladen), Ink-Leiste ist dort
// ohne Hover sichtbar, der schwebende Knopf schaltet zurück. Ink-Daten überstehen das Neuladen.
import assert from "node:assert/strict";
const ID = "obsidian-ink-blocks";

export default async (h) => {
	/** Nach `location.reload()`: warten, bis Obsidian und das Plugin wieder da sind. */
	const afterReload = async () => {
		await h.sleep(1500);
		await h.waitFor(() => h.evaluate(() => !!window.app?.workspace?.layoutReady), { what: "layoutReady nach Neuladen" });
		await h.evaluate(async (id) => {
			if (!app.plugins.isEnabled?.() && app.plugins.setEnable) await app.plugins.setEnable(true);
			if (!app.plugins.plugins[id]) await app.plugins.enablePlugin(id);
		}, ID);
		await h.waitFor(() => h.evaluate((id) => !!app.plugins.plugins[id], ID), { what: "Plugin nach Neuladen" });
		await h.evaluate(() => document.querySelector(".mod-trust-folder .modal-header-button, .mod-trust-folder .modal-close-button")?.click());
		await h.sleep(300);
	};
	const openNote = () =>
		h.evaluate(async () => {
			await app.workspace.getLeaf().openFile(app.vault.getFileByPath("Notiz.md"), { state: { mode: "source", source: false } });
		});

	// 1. Desktop: Ribbon-Knopf, kein schwebender Knopf
	assert.equal(await h.evaluate(() => document.body.hasClass("is-mobile")), false);
	assert.ok(await h.evaluate(() => !!document.querySelector('.side-dock-ribbon-action[aria-label="iPad-Modus einschalten"]')), "Ribbon-Knopf fehlt");
	assert.equal(await h.evaluate(() => !!document.querySelector(".ink-tablet-toggle")), false);

	// Block mit einem Strich anlegen
	await openNote();
	await h.evaluate(() => {
		app.workspace.activeEditor.editor.setCursor({ line: 3, ch: 0 });
		app.commands.executeCommandById("obsidian-ink-blocks:insert-notebook");
	});
	await h.sleep(800);
	const r = await h.evaluate(() => { const b = document.querySelector(".markdown-source-view .ink-surface").getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width }; });
	await h.draw(Array.from({ length: 20 }, (_, i) => [r.x + r.w * (0.1 + i * 0.02), r.y + 80 + 5 * Math.sin(i), 0.6]), { pointerType: "pen" });
	await h.sleep(200);

	// 2. Einschalten per Befehl → Neuladen in die Mobil-Oberfläche
	void h.evaluate(() => app.commands.executeCommandById("obsidian-ink-blocks:toggle-tablet-mode")).catch(() => {});
	await afterReload();
	const mobile = await h.evaluate(() => ({
		isMobile: document.body.hasClass("is-mobile"),
		emulate: document.body.hasClass("emulate-mobile"),
		key: localStorage.getItem("EmulateMobile"),
		toggle: !!document.querySelector(".ink-tablet-toggle"),
	}));
	assert.deepEqual(mobile, { isMobile: true, emulate: true, key: "1", toggle: true }, JSON.stringify(mobile));

	// 3. Block rendert, Strich ist noch da, Leiste ohne Hover sichtbar und groß
	await openNote();
	await h.sleep(1000);
	const block = await h.evaluate((id) => {
		const surface = document.querySelector(".markdown-source-view .ink-surface");
		const bar = document.querySelector(".markdown-source-view .ink-toolbar");
		if (!surface || !bar) return null;
		const btn = bar.querySelector("button").getBoundingClientRect();
		return {
			strokes: app.plugins.plugins[id].store.entries.get(surface.dataset.path)?.doc.strokes.length,
			opacity: getComputedStyle(bar).opacity,
			visibility: getComputedStyle(bar).visibility,
			button: Math.round(btn.height),
		};
	}, ID);
	assert.ok(block, "Block/Leiste in der Mobil-Oberfläche fehlt");
	assert.equal(block.strokes, 1, "Strich nach dem Neuladen verloren");
	assert.equal(block.opacity, "1");
	assert.equal(block.visibility, "visible");
	assert.equal(block.button, 40);
	await h.screenshot("m10-tablet.png");

	// 4. Schwebender Knopf schaltet zurück
	const t = await h.evaluate(() => { const b = document.querySelector(".ink-tablet-toggle").getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; });
	await h.click(t.x, t.y).catch(() => {});
	await afterReload();
	const desktop = await h.evaluate(() => ({
		isMobile: document.body.hasClass("is-mobile"),
		key: localStorage.getItem("EmulateMobile"),
		toggle: !!document.querySelector(".ink-tablet-toggle"),
	}));
	assert.deepEqual(desktop, { isMobile: false, key: null, toggle: false }, JSON.stringify(desktop));
};
