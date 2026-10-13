// M5: Handschrift → text:-Feld (lokal, Worker), Suche, kein Schreiben ohne Änderung, Nutzer-Edits bleiben,
// erzwungene Erkennung, offline.
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

	const rect = () =>
		h.evaluate(() => {
			const el = document.querySelector(".markdown-source-view .ink-surface");
			const r = el.getBoundingClientRect();
			return { x: r.x + el.clientLeft, y: r.y + el.clientTop, w: el.clientWidth };
		});
	const write = async (text, opts) => {
		const r = await rect();
		const k = r.w / 1000;
		for (const pts of textToStrokes(text, { font: "EMSReadability", size: 50, ...opts })) {
			const path = [];
			for (let i = 0; i < pts.length; i += 3) path.push([r.x + pts[i] * k, r.y + pts[i + 1] * k, pts[i + 2]]);
			await h.draw(path, { step: 0 });
		}
	};
	const field = () =>
		h.evaluate(() => {
			const m = /```ink\n[\s\S]*?text: \|\n((?:  .*\n?)+)/.exec(app.workspace.activeEditor.editor.getValue());
			return m ? m[1].split("\n").map((l) => l.replace(/^  /, "")).join("\n").trim() : null;
		});
	const waitField = (pred, what) => h.waitFor(async () => { const f = await field(); return pred(f) ? f : null; }, { timeout: 30000, what });

	// 1. Schreiben → nach der Ruhepause steht der erkannte Text im Block
	await write("Hallo Welt", { y: 70, seed: 1 });
	await write("Subnetzmaske 255.255.255.0", { y: 150, seed: 2 });
	const t0 = Date.now();
	let text = await waitField((f) => f && /Subnetz/.test(f), "text: mit Erkennung");
	console.log(`  erkannt nach ${Date.now() - t0} ms: ${JSON.stringify(text)}`);
	assert.match(text, /Hallo Welt/);
	assert.match(text, /Subnetzmaske 255\.255\.255\.0/);
	await h.sleep(300);
	assert.ok(await h.evaluate(() => !!document.querySelector(".markdown-source-view .ink-surface")), "Block nach dem Schreiben im Quelltext");
	assert.ok(await h.evaluate(() => !!document.querySelector(".markdown-source-view .ink-block.is-active")), "Block nach Re-Render nicht wieder aktiv");
	await h.screenshot("m5-recognized.png");

	// 2. Obsidian-Suche findet die Handschrift
	await h.sleep(2500); // Autosave der Notiz
	const hits = await h.evaluate(async () => {
		app.internalPlugins.getPluginById("global-search").instance.openGlobalSearch("Subnetzmaske");
		for (let i = 0; i < 50; i++) {
			const titles = [...document.querySelectorAll(".search-result-file-title")].map((e) => e.textContent);
			if (titles.length) return titles;
			await new Promise((r) => setTimeout(r, 100));
		}
		return [];
	});
	assert.ok(hits.some((t) => /Notiz/.test(t)), `Suche: ${JSON.stringify(hits)}`);
	// Fokus zurück auf die Notiz (die Suche hat ihn übernommen)
	await h.evaluate(() => {
		const leaf = app.workspace.getLeavesOfType("markdown").find((l) => l.view.file?.path === "Notiz.md");
		app.workspace.setActiveLeaf(leaf, { focus: true });
	});
	assert.equal(await h.evaluate(() => app.workspace.activeEditor?.file?.path), "Notiz.md");

	// 3. Erneuter Lauf ohne Änderung schreibt nichts
	const changes = await h.evaluate(async () => {
		let n = 0;
		const ref = app.workspace.on("editor-change", () => n++);
		app.commands.executeCommandById("obsidian-ink-blocks:recognize-note");
		await new Promise((r) => setTimeout(r, 3000));
		app.workspace.offref(ref);
		return n;
	});
	assert.equal(changes, 0, "No-op-Lauf hat die Notiz geändert");

	// 4. Vom Nutzer bearbeiteter Text bleibt erhalten …
	await h.evaluate(() => {
		const ed = app.workspace.activeEditor.editor;
		ed.setValue(ed.getValue().replace(/text: \|\n(  .*\n?)+/, "text: |\n  mein eigener Text\n"));
		ed.setCursor({ line: 0, ch: 0 });
	});
	await h.sleep(500);
	await write("Test", { y: 230, seed: 3 });
	await h.sleep(4000);
	assert.equal(await field(), "mein eigener Text", "Nutzer-Text überschrieben");
	// … bis man die Erkennung erzwingt
	await h.evaluate(() => {
		app.workspace.activeEditor.editor.setCursor({ line: 0, ch: 0 });
		app.commands.executeCommandById("obsidian-ink-blocks:recognize-note");
	});
	text = await waitField((f) => f && /Hallo/.test(f), "erzwungene Erkennung");
	assert.match(text, /Test/);

	// 5. Offline
	await h.cdp.send("Network.enable");
	await h.cdp.send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
	await write("Oktett", { y: 300, seed: 4 });
	text = await waitField((f) => f && /Okt/.test(f), "Erkennung offline");
	console.log(`  offline: ${JSON.stringify(text)}`);
	await h.screenshot("m5-final.png");
};
