// M22: Schreibtraining – Diktat (Vorgabe schreiben → Probe in _ink/_training/samples-<Gerät>.jsonl), Überprüfen
// (Wörter einzeln mit Strichen, Korrektur landet sofort im Block und bleibt), Abstimmen auf die eigenen Proben.
import assert from "node:assert/strict";
import { textToStrokes } from "../lib/hershey.mjs";
const ID = "obsidian-ink-blocks";

export default async (h) => {
	h.evalTimeout = 180000;
	await h.evaluate((id) => { app.plugins.plugins[id].settings.ocrDelay = 1; }, ID);

	/** Text mit dem Hershey-Font auf eine Fläche schreiben (Maus). */
	const write = async (sel, text, opts = {}) => {
		const r = await h.evaluate((sel) => {
			const el = document.querySelector(sel);
			const b = el.getBoundingClientRect();
			return { x: b.x + el.clientLeft, y: b.y + el.clientTop, w: el.clientWidth };
		}, sel);
		const k = r.w / 1000;
		for (const pts of textToStrokes(text, { font: "EMSReadability", size: 50, ...opts })) {
			const path = [];
			for (let i = 0; i < pts.length; i += 3) path.push([r.x + pts[i] * k, r.y + pts[i + 1] * k, pts[i + 2]]);
			await h.draw(path, { step: 0 });
		}
	};
	const samples = () =>
		h.evaluate(async (id) => (await app.plugins.plugins[id].training.load()).map((s) => ({ text: s.text, got: s.got, source: s.source, key: s.key, n: s.strokes.length })), ID);

	// 0. Alle Symbole des Trainings gibt es in dieser Obsidian-Version.
	const icons = await h.evaluate((id) => app.plugins.plugins[id].dev.getIconIds(), ID);
	for (const icon of ["graduation-cap", "pencil-line", "file-check", "list-checks", "sliders-horizontal", "skip-forward", "eraser", "check", "x", "ban", "pencil", "rotate-ccw"]) {
		assert.ok(icons.includes(icon) || icons.includes(`lucide-${icon}`), `Icon fehlt: ${icon}`);
	}
	assert.ok(await h.evaluate(() => !!document.querySelector('.side-dock-ribbon-action[aria-label="Schreibtraining"]')), "Hut in der Seitenleiste");

	// 1. Diktat: Vorgabe erscheint, schreiben, Enter → Probe mit Vorgabe als Soll-Text, Rückmeldung im Dialog.
	await h.evaluate(() => app.commands.executeCommandById("obsidian-ink-blocks:training-dictation"));
	const prompt = await h.waitFor(
		() => h.evaluate(() => { const t = document.querySelector(".ink-training-prompt")?.textContent; return t && !t.startsWith("Lade") ? t : null; }),
		{ timeout: 30000, what: "Diktat-Vorgabe" },
	);
	assert.ok(prompt.split(" ").length <= 3, `Vorgabe „${prompt}“`);
	await write(".ink-training-modal .ink-surface", "Hallo", { y: 70, seed: 3 });
	await h.sleep(300);
	await h.key("Enter", { code: "Enter" });
	const after = await h.waitFor(async () => { const s = await samples(); return s.length ? s : null; }, { timeout: 60000, what: "Probe gespeichert" });
	assert.equal(after[0].text, prompt);
	assert.equal(after[0].source, "dictation");
	assert.ok(after[0].n > 0, "Striche in der Probe");
	const next = await h.evaluate(() => document.querySelector(".ink-training-prompt").textContent);
	assert.notEqual(next, prompt, "nächste Vorgabe");
	const strokesLeft = await h.evaluate(() => document.querySelectorAll(".ink-training-modal .ink-surface").length);
	assert.equal(strokesLeft, 1);
	await h.waitFor(() => h.evaluate(() => !!document.querySelector(".ink-training-result")), { timeout: 30000, what: "Rückmeldung" });
	await h.screenshot("m22-dictation.png");
	const files = await h.evaluate(() => app.vault.getFiles().filter((f) => f.path.startsWith("_ink/_training/")).map((f) => f.path));
	assert.equal(files.length, 1);
	assert.match(files[0], /^_ink\/_training\/samples-[a-z0-9]{6}\.jsonl$/);
	await h.key("Escape", { code: "Escape" });
	await h.sleep(300);

	// 2. Überprüfen: Block mit zwei Wörtern, OCR abwarten, dann alle Wörter zeigen lassen und eines korrigieren.
	await h.evaluate(async () => {
		await app.workspace.getLeaf().openFile(app.vault.getFileByPath("Notiz.md"), { state: { mode: "source", source: false } });
		app.workspace.activeEditor.editor.setCursor({ line: 3, ch: 0 });
		app.commands.executeCommandById("obsidian-ink-blocks:insert-notebook");
	});
	await h.sleep(800);
	await write(".markdown-source-view .ink-surface", "Hallo Welt", { y: 70, seed: 1 });
	const field = () =>
		h.evaluate(() => {
			const m = /```ink\n[\s\S]*?text: \|\n((?:  .*\n?)+)/.exec(app.workspace.activeEditor.editor.getValue());
			return m ? m[1].split("\n").map((l) => l.replace(/^  /, "")).join("\n").trim() : null;
		});
	const first = await h.waitFor(field, { timeout: 60000, what: "erkannter Text" });
	assert.equal(first.split(" ").length, 2, `zwei Wörter erkannt: „${first}“`);

	await h.evaluate(() => app.commands.executeCommandById("obsidian-ink-blocks:training-review-note"));
	await h.waitFor(() => h.evaluate(() => !!document.querySelector(".ink-review-modal")), { what: "Überprüfen-Dialog" });
	// „Nur unsichere Wörter“ aus → beide Wörter
	await h.evaluate(() => document.querySelector(".ink-review-modal .ink-training-auto input").click());
	const shown = await h.waitFor(
		() => h.evaluate(() => { const b = document.querySelector(".ink-review-body"); return b && b.style.display !== "none" && document.querySelector(".ink-review-input").value ? document.querySelector(".ink-review-input").value : null; }),
		{ timeout: 60000, what: "erstes Wort" },
	);
	assert.ok(first.split(" ").includes(shown), `„${shown}“ gehört zu „${first}“`);
	const preview = await h.evaluate(() => {
		const c = document.querySelector(".ink-review-preview");
		const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
		let ink = 0;
		for (let i = 3; i < d.length; i += 4) if (d[i] > 0) ink++;
		return ink;
	});
	assert.ok(preview > 100, "Vorschau zeigt Striche");
	await h.screenshot("m22-review.png");
	// Korrigieren: das Wort wird zu „Korrektur“
	await h.evaluate(() => {
		const input = document.querySelector(".ink-review-input");
		input.value = "Korrektur";
		input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
	});
	await h.sleep(500);
	// Das zweite Wort ist richtig
	const second = await h.evaluate(() => document.querySelector(".ink-review-input").value);
	await h.evaluate(() => [...document.querySelectorAll(".ink-review-modal button")].find((b) => b.textContent.trim() === "Richtig").click());
	await h.sleep(500);
	const status = await h.evaluate(() => document.querySelector(".ink-review-modal .ink-training-stats").textContent);
	assert.match(status, /2 geprüft/);
	await h.key("Escape", { code: "Escape" });
	const corrected = first.split(" ").map((w) => (w === shown ? "Korrektur" : w)).join(" ");
	await h.waitFor(async () => ((await field()) === corrected ? true : null), { timeout: 30000, what: `Korrektur im Block („${corrected}“)` });
	const review = (await samples()).filter((s) => s.source === "review");
	assert.equal(review.length, 2);
	assert.deepEqual(review.map((s) => [s.got, s.text]), [[shown, "Korrektur"], [second, second]]);
	assert.ok(review.every((s) => s.key && s.n > 0));
	const fixed = await h.evaluate((id) => {
		const path = /file: (.*)/.exec(app.workspace.activeEditor.editor.getValue())[1];
		return app.plugins.plugins[id].store.entries.get(path).doc.ocr.fixed;
	}, ID);
	assert.deepEqual(Object.values(fixed), [corrected]);
	// Engine-Wechsel verwirft den Zeilen-Cache – die Korrektur bleibt.
	await h.evaluate(async (id) => {
		const p = app.plugins.plugins[id];
		p.settings.ocrLanguageModel = false;
		p.ocr.reset();
		app.commands.executeCommandById("obsidian-ink-blocks:recognize-note");
	}, ID);
	await h.sleep(4000);
	assert.equal(await field(), corrected, "Korrektur übersteht neue Erkennung");
	await h.evaluate((id) => { app.plugins.plugins[id].settings.ocrLanguageModel = true; app.plugins.plugins[id].ocr.reset(); }, ID);

	// Ein zweites Mal überprüfen: geprüfte Wörter kommen nicht wieder.
	await h.evaluate(() => app.commands.executeCommandById("obsidian-ink-blocks:training-review-note"));
	await h.waitFor(() => h.evaluate(() => /fertig|nichts/.test(document.querySelector(".ink-review-modal .ink-training-stats")?.textContent ?? "")), { timeout: 60000, what: "nichts mehr offen" });
	await h.key("Escape", { code: "Escape" });

	// 3. Abstimmen: 24 Proben (Hershey-Schrift, bekannter Text), dann Raster im Worker.
	const words = ["Router", "Paket", "Netzwerk", "Schicht", "Adresse", "Server", "Tabelle", "Protokoll", "Datei", "Wasser", "Himmel", "Vogel"];
	const synthetic = words.flatMap((w, i) => [w, `${w} ${words[(i + 5) % words.length]}`]).map((text, i) => ({
		text,
		strokes: textToStrokes(text, { font: "EMSReadability", size: 50, y: 70, seed: 10 + i }),
	}));
	await h.evaluate(async ([id, list]) => {
		const p = app.plugins.plugins[id];
		for (const s of list) await p.training.add({ text: s.text, got: "", source: "dictation", engine: "test", strokes: s.strokes, refHeight: 22 });
	}, [ID, synthetic]);
	const t0 = Date.now();
	const tuned = await h.evaluate(async (id) => {
		const p = app.plugins.plugins[id];
		const { runTuning } = p.dev.training;
		const ok = await runTuning(p);
		return { ok, tuned: p.settings.ocrTuned, notice: [...document.querySelectorAll(".notice")].map((n) => n.textContent).join(" | ") };
	}, ID);
	console.log(`    Abstimmen: ${((Date.now() - t0) / 1000).toFixed(1)} s · ${tuned.notice.split(" | ").at(-1)}`);
	assert.doesNotMatch(tuned.notice, /fehlgeschlagen|nicht möglich/);
	assert.match(tuned.notice, /Abgestimmt|Keine bessere/);
	if (tuned.ok) assert.ok(tuned.tuned && tuned.tuned.samples >= 24);
};
