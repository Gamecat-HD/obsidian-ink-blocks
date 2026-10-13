// M6: Fallback-Kette de-htr-web-v2 → v1 → Tesseract.js (Laufzeitfehler und fehlende Dateien), jeweils mit
// Hinweis; manuelle Engine-Wahl wird respektiert (kein Fallback).
import assert from "node:assert/strict";
import { textToStrokes } from "../lib/hershey.mjs";
const ID = "obsidian-ink-blocks";

export const options = { models: "copy" };

export default async (h) => {
	h.evalTimeout = 120000;
	await h.evaluate((id) => { app.plugins.plugins[id].settings.ocrDelay = 1; }, ID);
	await h.evaluate(async () => {
		await app.workspace.getLeaf().openFile(app.vault.getFileByPath("Notiz.md"), { state: { mode: "source", source: false } });
		app.workspace.activeEditor.editor.setCursor({ line: 3, ch: 0 });
		app.commands.executeCommandById("obsidian-ink-blocks:insert-notebook");
	});
	await h.sleep(800);

	const r = await h.evaluate(() => {
		const el = document.querySelector(".markdown-source-view .ink-surface");
		const b = el.getBoundingClientRect();
		return { x: b.x + el.clientLeft, y: b.y + el.clientTop, w: el.clientWidth, path: el.dataset.path };
	});
	const k = r.w / 1000;
	const write = async (text, y) => {
		for (const pts of textToStrokes(text, { font: "EMSReadability", size: 55, y })) {
			const path = [];
			for (let i = 0; i < pts.length; i += 3) path.push([r.x + pts[i] * k, r.y + pts[i + 1] * k, pts[i + 2]]);
			await h.draw(path, { step: 0 });
		}
	};
	await h.evaluate(() => document.querySelectorAll(".notice").forEach((n) => n.remove()));
	await write("Hallo Welt", 80);

	const state = () =>
		h.evaluate((id, p) => {
			const entry = app.plugins.plugins[id].store.entries.get(p);
			const m = /text: \|\n((?:  .*\n?)+)/.exec(app.workspace.activeEditor.editor.getValue());
			return {
				engine: entry?.doc.ocr?.engine ?? null,
				text: m ? m[1].replace(/^  /gm, "").trim() : null,
				notices: [...document.querySelectorAll(".notice")].map((n) => n.textContent),
			};
		}, ID, r.path);
	const recognizeNote = async () => {
		await h.evaluate(() => {
			document.querySelectorAll(".notice").forEach((n) => n.remove());
			app.workspace.activeEditor.editor.setCursor({ line: 0, ch: 0 });
			app.commands.executeCommandById("obsidian-ink-blocks:recognize-note");
		});
		await h.waitFor(async () => (await state()).notices.some((n) => /Handschrift erkannt|Modelle fehlen/.test(n)), { timeout: 90000, what: "Erkennung" });
		return state();
	};
	const modelPath = (rel) => h.evaluate((id, rel) => `${app.plugins.plugins[id].manifest.dir}/models/${rel}`, ID, rel);

	// 1. Standard: v2
	let s = await h.waitFor(async () => { const st = await state(); return st.text ? st : null; }, { timeout: 30000, what: "Erkennung v2" });
	assert.match(s.engine, /^htr-v2@/);
	console.log(`  v2:  ${JSON.stringify(s.text)}`);

	// 2. v2 kaputt (Config gleicher Größe, aber kein JSON) → Laufzeitfehler → v1 mit Hinweis
	await h.evaluate(() => document.querySelectorAll(".notice").forEach((n) => n.remove()));
	const cfg = await modelPath("de-htr-web-v2/config.json");
	await h.evaluate(async (p) => {
		const size = (await app.vault.adapter.stat(p)).size;
		await app.vault.adapter.write(p, "x".repeat(size));
	}, cfg);
	await h.evaluate((id) => app.plugins.plugins[id].ocr.reset(), ID);
	// Neues Wort → muss erkannt werden (bereits erkannte Segmente kommen aus dem Cache)
	await write("Netz", 170);
	s = await h.waitFor(async () => { const st = await state(); return /^htr-v1@/.test(st.engine ?? "") && /Netz|Hallo/.test(st.text ?? "") ? st : null; }, { timeout: 60000, what: "Fallback auf v1" });
	assert.ok(s.notices.some((n) => /nutze de-htr-web \(v1\)/.test(n)), `Hinweis fehlt: ${s.notices}`);
	console.log(`  v1:  ${JSON.stringify(s.text)}`);
	assert.ok(s.text, "v1 ohne Text");

	// 3. v1 fehlt → Tesseract.js mit Hinweis
	await h.evaluate(async (p) => app.vault.adapter.remove(p), await modelPath("de-htr-web/model.onnx"));
	await h.evaluate((id) => {
		app.plugins.plugins[id].ocr.reset();
		document.querySelectorAll(".notice").forEach((n) => n.remove());
	}, ID);
	await write("Maske", 250);
	s = await h.waitFor(async () => { const st = await state(); return /^tesseract@/.test(st.engine ?? "") && st.text ? st : null; }, { timeout: 90000, what: "Fallback auf Tesseract" });
	assert.ok(s.notices.some((n) => /nutze Tesseract\.js/.test(n)), `Hinweis fehlt: ${s.notices}`);
	console.log(`  tesseract: ${JSON.stringify(s.text)}`);
	assert.ok(s.text, "Tesseract ohne Text");

	// 4. Manuelle Wahl einer fehlenden Engine → kein Fallback, Hinweis auf fehlende Modelle
	await h.evaluate((id) => {
		const p = app.plugins.plugins[id];
		p.settings.ocrEngine = "htr-v1";
		p.ocr.reset();
	}, ID);
	const before = s.text;
	s = await recognizeNote();
	assert.ok(s.notices.some((n) => /Modelle fehlen/.test(n)), `Hinweis fehlt: ${s.notices}`);
	assert.match(s.engine, /^tesseract@/, "Engine gewechselt trotz manueller Wahl");
	assert.equal(s.text, before);

	// 5. Manuell Tesseract → nutzt Tesseract ohne Fallback-Hinweis
	await h.evaluate((id) => {
		const p = app.plugins.plugins[id];
		p.settings.ocrEngine = "tesseract";
		p.ocr.reset();
	}, ID);
	s = await recognizeNote();
	assert.ok(!s.notices.some((n) => /nutze/.test(n)), `unerwarteter Hinweis: ${s.notices}`);
	assert.match(s.engine, /^tesseract@/);
};
