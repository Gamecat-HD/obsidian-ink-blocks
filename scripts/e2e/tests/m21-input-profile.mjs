// M21: Eingabeprofil je Gerät – „Finger zeichnen“ (Tablet ohne aktiven Stift): ein Finger schreibt, zwei Finger
// scrollen bzw. tippen Rückgängig, Handballen (große Kontaktfläche) zählt nicht; „Automatisch“ schaltet beim ersten
// echten Stiftkontakt auf „nur Stift“ um. Das Profil liegt in localStorage, nicht in data.json.
import assert from "node:assert/strict";
const ID = "obsidian-ink-blocks";

export default async (h) => {
	await h.evaluate(async () => {
		await app.workspace.getLeaf().openFile(app.vault.getFileByPath("Notiz.md"), { state: { mode: "source", source: false } });
		app.workspace.activeEditor.editor.setCursor({ line: 3, ch: 0 });
		app.commands.executeCommandById("obsidian-ink-blocks:insert-notebook");
	});
	await h.sleep(800);
	const surface = ".markdown-source-view .ink-surface";
	const r = await h.evaluate((sel) => { const b = document.querySelector(sel).getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width }; }, surface);
	const count = () => h.evaluate(([id, sel]) => app.plugins.plugins[id].store.entries.get(document.querySelector(sel).dataset.path).doc.strokes.length, [ID, surface]);
	const touch = (type, points, radius = 5) =>
		h.cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points.map(([x, y], id) => ({ x, y, id, radiusX: radius, radiusY: radius, force: 1 })) });
	const fingerStroke = async (y, radius = 5) => {
		await touch("touchStart", [[r.x + 100, r.y + y]], radius);
		for (let i = 1; i <= 10; i++) {
			await touch("touchMove", [[r.x + 100 + i * 12, r.y + y + (i % 2) * 4]], radius);
			await h.sleep(16);
		}
		await touch("touchEnd", []);
		await h.sleep(250);
	};
	const fingerTap = async (n) => {
		await touch("touchStart", Array.from({ length: n }, (_, i) => [r.x + 300 + i * 60, r.y + 200]));
		await h.sleep(60);
		await touch("touchEnd", []);
		await h.sleep(250);
	};
	const setProfile = (p) => h.evaluate((p) => (p ? localStorage.setItem("ink-blocks-input-profile", p) : localStorage.removeItem("ink-blocks-input-profile")), p);

	// 1. Desktop, Automatisch, kein Stift gesehen: wie bisher („Nur Stift zeichnet“) – ein Finger zeichnet nicht.
	await h.evaluate(() => localStorage.removeItem("ink-blocks-pen-seen"));
	await setProfile(null);
	assert.equal(await h.evaluate((id) => app.plugins.plugins[id].penOnly, ID), true);
	await fingerStroke(60);
	assert.equal(await count(), 0, "Finger zeichnet im Stift-Profil nicht");

	// 2. Profil „Finger zeichnen“: ein Finger schreibt, Handballen nicht, Zwei-Finger-Tipp nimmt zurück.
	await setProfile("finger");
	assert.equal(await h.evaluate((id) => app.plugins.plugins[id].penOnly, ID), false);
	await fingerStroke(60);
	assert.equal(await count(), 1, "Finger zeichnet");
	const simulated = await h.evaluate(([id, sel]) => app.plugins.plugins[id].store.entries.get(document.querySelector(sel).dataset.path).doc.strokes[0].simulated, [ID, surface]);
	assert.equal(simulated, true, "Fingerstrich hat simulierten Druck");
	await fingerStroke(120, 30);
	assert.equal(await count(), 1, "Handballen (große Kontaktfläche) zeichnet nicht");
	await fingerTap(2);
	assert.equal(await count(), 0, "Zwei-Finger-Tipp = Rückgängig");
	assert.equal(await h.evaluate((id) => app.plugins.plugins[id].settings.penOnly, ID), true, "data.json bleibt unberührt");

	// 3. Automatisch auf einem Gerät, das Finger zeichnen lässt (alte Einstellung aus): erster Stift → nur noch Stift.
	await setProfile(null);
	await h.evaluate((id) => { app.plugins.plugins[id].settings.penOnly = false; }, ID);
	assert.equal(await h.evaluate((id) => app.plugins.plugins[id].penOnly, ID), false);
	await h.draw(Array.from({ length: 10 }, (_, i) => [r.x + 100 + i * 10, r.y + 150, 0.6]), { pointerType: "pen" });
	await h.sleep(700);
	assert.equal(await count(), 1, "Stift zeichnet");
	assert.equal(await h.evaluate(() => localStorage.getItem("ink-blocks-pen-seen")), "1");
	assert.equal(await h.evaluate((id) => app.plugins.plugins[id].penOnly, ID), true, "nach dem Stift: nur Stift");
	const notice = await h.evaluate(() => [...document.querySelectorAll(".notice")].map((n) => n.textContent).join(" | "));
	assert.match(notice, /Stift erkannt/);
	await fingerStroke(220);
	assert.equal(await count(), 1, "Finger zeichnet jetzt nicht mehr");

	// 4. Einstellungen: Auswahl „Eingabe auf diesem Gerät“ statt Schalter „Nur Stift zeichnet“.
	const settings = await h.evaluate(async (id) => {
		const tab = app.setting.pluginTabs.find((t) => t.plugin?.manifest?.id === id);
		tab.display();
		await new Promise((r) => setTimeout(r, 300));
		return [...tab.containerEl.querySelectorAll(".setting-item-name")].map((e) => e.textContent);
	}, ID);
	assert.ok(settings.includes("Eingabe auf diesem Gerät"), JSON.stringify(settings));
	assert.ok(settings.includes("Sparmodus auf diesem Gerät"));
	assert.ok(!settings.includes("Nur Stift zeichnet"));
	await h.evaluate(() => { localStorage.removeItem("ink-blocks-pen-seen"); localStorage.removeItem("ink-blocks-input-profile"); });
};
