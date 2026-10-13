// M1: Block einfügen, .ink anlegen/laden/speichern, Reload, externe Änderung, Umbenennen, Löschen, kaputte Datei.
import assert from "node:assert/strict";
const ID = "obsidian-ink-blocks";

export default async (h) => {
	const surface = (path) =>
		h.evaluate((p) => {
			const el = document.querySelector(`.markdown-source-view .ink-surface[data-path="${p}"]`);
			return el ? { strokes: Number(el.dataset.strokes), ratio: el.style.aspectRatio } : null;
		}, path);
	const message = () =>
		h.evaluate(() => document.querySelector(".markdown-source-view .ink-message-title")?.textContent ?? null);
	// Inhalt der offenen Notiz aus dem Editor (die Datei wird von Obsidian verzögert gespeichert).
	const noteText = () => h.evaluate(() => app.workspace.activeEditor.editor.getValue());

	// 1. Einfügen per Command in Live Preview
	await h.evaluate(async () => {
		await app.workspace.getLeaf().openFile(app.vault.getFileByPath("Notiz.md"), { state: { mode: "source", source: false } });
		app.workspace.activeEditor.editor.setCursor({ line: 3, ch: 0 });
		app.commands.executeCommandById("obsidian-ink-blocks:insert-notebook");
	});
	await h.sleep(800);
	const text = await noteText();
	const m = /```ink\nfile: (_ink\/\d{4}-\d\d-\d\d-notiz-[0-9a-z]{4}\.ink)\n```/.exec(text);
	assert.ok(m, `Block fehlt in Notiz:\n${text}`);
	const path = m[1];
	assert.match(text, /Absatz vor dem Block\.\n\n```ink/);
	const json = await h.evaluate((p) => app.vault.adapter.read(p), path);
	assert.equal(JSON.parse(json).space, "nb");
	assert.deepEqual(await surface(path), { strokes: 0, ratio: "1000 / 400" });

	// 2. Änderung über den Store → gebündelt gespeichert (20 schnelle Änderungen ≤ 3 Writes)
	const writes = await h.evaluate(async (id, p) => {
		const plugin = app.plugins.plugins[id];
		const entry = plugin.store.entries.get(p);
		let count = 0;
		const ref = app.vault.on("modify", (f) => f.path === p && count++);
		for (let i = 0; i < 20; i++) {
			entry.doc.strokes.push({ id: `s${i}`, tool: "pen", color: 0, size: 3, points: [i, i, 0.5, i + 1, i + 2, 0.7] });
			plugin.store.touch(entry);
			await new Promise((r) => setTimeout(r, 50));
		}
		await new Promise((r) => setTimeout(r, 2200));
		app.vault.offref(ref);
		return count;
	}, ID, path);
	assert.ok(writes >= 1 && writes <= 3, `writes=${writes}`);
	assert.equal(JSON.parse(await h.evaluate((p) => app.vault.adapter.read(p), path)).strokes.length, 20);

	// 3. Reload: Plugin aus/an → Block lädt Datei neu
	await h.evaluate(async (id) => { await app.plugins.disablePlugin(id); await app.plugins.enablePlugin(id); }, ID);
	await h.sleep(800);
	assert.equal((await surface(path))?.strokes, 20, "nach Reload");
	await h.screenshot("m1-surface.png");

	// 4. Externe Änderung (z. B. LiveSync) → Block aktualisiert sich
	await h.evaluate(async (p) => {
		const f = app.vault.getFileByPath(p);
		const d = JSON.parse(await app.vault.read(f));
		d.strokes = d.strokes.slice(0, 5);
		await app.vault.modify(f, JSON.stringify(d));
	}, path);
	await h.sleep(500);
	assert.equal((await surface(path))?.strokes, 5, "nach externer Änderung");

	// 5. Umbenennen → file:-Zeile wird nachgezogen
	await h.evaluate((p) => app.fileManager.renameFile(app.vault.getFileByPath(p), "_ink/umbenannt.ink"), path);
	await h.sleep(800);
	assert.match(await noteText(), /```ink\nfile: _ink\/umbenannt\.ink\n```/);
	assert.equal((await surface("_ink/umbenannt.ink"))?.strokes, 5, "nach Umbenennen");

	// 6. Löschen → Platzhalter; Wiederanlegen → Block erscheint wieder
	const backup = await h.evaluate((p) => app.vault.adapter.read(p), "_ink/umbenannt.ink");
	await h.evaluate((p) => app.vault.delete(app.vault.getFileByPath(p)), "_ink/umbenannt.ink");
	await h.sleep(500);
	assert.match(await message(), /Ink-Datei fehlt: _ink\/umbenannt\.ink/);
	await h.evaluate((p, t) => app.vault.create(p, t), "_ink/umbenannt.ink", backup);
	await h.sleep(500);
	assert.equal((await surface("_ink/umbenannt.ink"))?.strokes, 5, "nach Wiederanlegen");

	// 7. Kaputte Datei → Meldung, Datei bleibt unangetastet
	await h.evaluate(async () => {
		await app.vault.create("_ink/kaputt.ink", "{nope");
		await app.workspace.getLeaf().openFile(app.vault.getFileByPath("Block.md"), { state: { mode: "source", source: false } });
		const ed = app.workspace.activeEditor.editor;
		ed.setValue(ed.getValue().replace("_ink/test.ink", "_ink/kaputt.ink"));
	});
	await h.sleep(800);
	assert.match(await message(), /Ink-Datei beschädigt: _ink\/kaputt\.ink/);
	assert.equal(await h.evaluate(() => app.vault.adapter.read("_ink/kaputt.ink")), "{nope");
	await h.screenshot("m1.png");
};
