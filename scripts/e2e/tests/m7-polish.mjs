// M7: erkannter Text unter dem Block, Leiste blendet beim Zeichnen aus, Leseansicht, gleichzeitige Änderung
// (LiveSync) wird zusammengeführt, verwaiste .ink-Dateien finden/löschen.
import assert from "node:assert/strict";
import { textToStrokes } from "../lib/hershey.mjs";
const ID = "obsidian-ink-blocks";

export default async (h) => {
	h.evalTimeout = 90000;
	await h.evaluate((id) => { app.plugins.plugins[id].settings.ocrDelay = 1; }, ID);
	await h.evaluate(async () => {
		await app.workspace.getLeaf().openFile(app.vault.getFileByPath("Notiz.md"), { state: { mode: "source", source: false } });
		app.workspace.activeEditor.editor.setCursor({ line: 3, ch: 0 });
		app.commands.executeCommandById("obsidian-ink-blocks:insert-notebook");
	});
	await h.sleep(800);
	const surface = (view = "source") =>
		h.evaluate((view) => {
			const el = document.querySelector(`.markdown-${view === "source" ? "source" : "preview"}-view .ink-surface`);
			if (!el) return null;
			const b = el.getBoundingClientRect();
			return { x: b.x + el.clientLeft, y: b.y + el.clientTop, w: el.clientWidth, path: el.dataset.path };
		}, view);
	const write = async (text, y, view) => {
		const r = await surface(view);
		const k = r.w / 1000;
		for (const pts of textToStrokes(text, { font: "EMSReadability", size: 55, y })) {
			const path = [];
			for (let i = 0; i < pts.length; i += 3) path.push([r.x + pts[i] * k, r.y + pts[i + 1] * k, pts[i + 2]]);
			await h.draw(path, { step: 0 });
		}
	};
	const strokes = (p) => h.evaluate((id, p) => app.plugins.plugins[id].store.entries.get(p)?.doc.strokes.length ?? -1, ID, p);

	// 1. Leiste blendet während eines Strichs aus
	const r = await surface();
	await h.cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: r.x + 100, y: r.y + 100 });
	await h.cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: r.x + 100, y: r.y + 100, button: "left", buttons: 1, clickCount: 1 });
	await h.cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: r.x + 160, y: r.y + 110, button: "left", buttons: 1 });
	await h.sleep(150);
	const during = await h.evaluate(() => ({
		drawing: !!document.querySelector(".markdown-source-view .ink-block.is-drawing"),
		opacity: Number(getComputedStyle(document.querySelector(".markdown-source-view .ink-toolbar")).opacity),
	}));
	await h.cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: r.x + 160, y: r.y + 110, button: "left", buttons: 0, clickCount: 1 });
	await h.sleep(150);
	assert.ok(during.drawing && during.opacity < 0.3, `während des Strichs: ${JSON.stringify(during)}`);
	assert.equal(await h.evaluate(() => !!document.querySelector(".markdown-source-view .ink-block.is-drawing")), false);
	await h.key("z", { code: "KeyZ", modifiers: 2 });

	// 2. Erkannter Text erscheint unter dem Block
	await write("Hallo Welt", 80);
	const caption = await h.waitFor(() => h.evaluate(() => document.querySelector(".markdown-source-view .ink-caption")?.textContent ?? null), { timeout: 30000, what: "Caption" });
	assert.match(caption, /Hallo Welt/);
	await h.screenshot("m7-caption.png");

	// 3. Leseansicht: Block wird gerendert und man kann darin schreiben
	await h.evaluate(async () => {
		const leaf = app.workspace.getLeavesOfType("markdown").find((l) => l.view.file?.path === "Notiz.md");
		await leaf.setViewState({ ...leaf.getViewState(), state: { ...leaf.getViewState().state, mode: "preview" } });
	});
	await h.sleep(800);
	const pr = await surface("preview");
	assert.ok(pr, "kein Block in der Leseansicht");
	assert.match(await h.evaluate(() => document.querySelector(".markdown-preview-view .ink-caption")?.textContent ?? ""), /Hallo/);
	const n0 = await strokes(pr.path);
	await h.draw(Array.from({ length: 10 }, (_, i) => [pr.x + 300 + i * 6, pr.y + 200, 0.5]));
	assert.equal(await strokes(pr.path), n0 + 1, "Zeichnen in der Leseansicht");
	await h.screenshot("m7-reading.png");

	// 4. Gleichzeitige Änderung: lokaler Strich noch nicht gespeichert + Datei kommt per Sync mit fremdem Strich
	const merged = await h.evaluate(async (id, p) => {
		const plugin = app.plugins.plugins[id];
		const entry = plugin.store.entries.get(p);
		const local = { id: "lokal1", tool: "pen", color: 1, size: 3, points: [100, 300, 0.5, 200, 300, 0.5] };
		entry.doc.strokes.push(local);
		plugin.store.touch(entry); // Save läuft erst in 1,5 s
		const file = app.vault.getFileByPath(p);
		const remote = JSON.parse(await app.vault.read(file));
		remote.strokes.push({ id: "fremd1", t: "pen", c: 2, s: 3, p: [3000, 3300, 128, 1000, 0, 0] });
		await app.vault.modify(file, JSON.stringify(remote));
		// Speichern ist gebündelt (1,5 s nach der letzten Änderung); eine laufende Texterkennung verlängert das.
		await new Promise((r) => setTimeout(r, 5000));
		const saved = JSON.parse(await app.vault.read(file)).strokes.map((s) => s.id);
		return { mem: entry.doc.strokes.map((s) => s.id), saved };
	}, ID, pr.path);
	for (const id of ["lokal1", "fremd1"]) {
		assert.ok(merged.mem.includes(id), `${id} fehlt im Speicher`);
		assert.ok(merged.saved.includes(id), `${id} fehlt in der Datei`);
	}
	assert.equal(merged.saved.length, n0 + 3);

	// 5. Verwaiste Dateien
	await h.evaluate(async () => {
		await app.vault.create("_ink/verwaist.ink", '{"v":1,"id":"o","space":"nb","w":1000,"h":400,"strokes":[]}');
		app.commands.executeCommandById("obsidian-ink-blocks:find-orphans");
	});
	await h.sleep(500);
	const listed = await h.evaluate(() => [...document.querySelectorAll(".ink-orphan-list li")].map((li) => li.textContent));
	// _ink/test.ink aus Block.md existiert nicht → nur die neue Datei ist verwaist
	assert.equal(listed.length, 1, JSON.stringify(listed));
	assert.match(listed[0], /^_ink\/verwaist\.ink/);
	await h.evaluate(() => document.querySelector(".ink-orphan-actions .mod-warning").click());
	await h.sleep(500);
	assert.equal(await h.evaluate(() => !!app.vault.getFileByPath("_ink/verwaist.ink")), false, "nicht gelöscht");
	assert.equal(await h.evaluate((p) => !!app.vault.getFileByPath(p), pr.path), true, "verwendete Datei gelöscht");
};
