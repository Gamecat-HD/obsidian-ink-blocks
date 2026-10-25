// M18: Abdeckband – gerades, deckendes Band in eigener SVG-Ebene (auch auf Arbeitsblättern nicht multipliziert),
// Tippen deckt auf/zu (Stift und Finger), „alle aufdecken“ in der Leiste, Ziehen auf dem Band zeichnet normal.
import assert from "node:assert/strict";
const ID = "obsidian-ink-blocks";

export default async (h) => {
	await h.evaluate(async () => {
		await app.workspace.getLeaf().openFile(app.vault.getFileByPath("Notiz.md"), { state: { mode: "source", source: false } });
		app.workspace.activeEditor.editor.setCursor({ line: 3, ch: 0 });
		app.commands.executeCommandById("obsidian-ink-blocks:insert-notebook");
	});
	await h.sleep(800);
	const icons = await h.evaluate((id) => app.plugins.plugins[id].dev.getIconIds(), ID);
	for (const icon of ["bandage", "eye", "eye-off"]) assert.ok(icons.includes(icon) || icons.includes(`lucide-${icon}`), `Icon fehlt: ${icon}`);

	const surface = ".markdown-source-view .ink-surface";
	const r = await h.evaluate((sel) => { const b = document.querySelector(sel).getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width }; }, surface);
	const state = () =>
		h.evaluate(([id, sel]) => {
			const el = document.querySelector(sel);
			const e = app.plugins.plugins[id].store.entries.get(el.dataset.path);
			const toggle = document.querySelector(".markdown-source-view .ink-tb-tape-toggle");
			return {
				strokes: e.doc.strokes.map((s) => ({ tool: s.tool, color: s.color, size: s.size, ys: [...new Set(s.points.filter((_, i) => i % 3 === 1).map((v) => Math.round(v)))].length })),
				tapes: [...el.querySelectorAll(".ink-tape-layer > g > .ink-tape")].map((g) => g.classList.contains("is-revealed")),
				toggle: toggle && getComputedStyle(toggle).display !== "none" ? toggle.classList.contains("is-active") : null,
			};
		}, [ID, surface]);
	const click = async (sel) => {
		const p = await h.evaluate((sel) => { const b = document.querySelector(sel).getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; }, sel);
		await h.cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: p.x, y: p.y });
		await h.sleep(150);
		await h.click(p.x, p.y);
		await h.sleep(150);
	};
	const tap = async (x, y) => {
		await h.draw([[r.x + x, r.y + y, 0.5], [r.x + x + 1, r.y + y, 0.5]], { pointerType: "pen" });
		await h.sleep(120);
	};

	// 1. Antwort schreiben, dann abkleben (wackelig gezogen → gerade, waagerecht)
	await h.draw(Array.from({ length: 20 }, (_, i) => [r.x + 100 + i * 10, r.y + 80 + 6 * Math.sin(i), 0.6]), { pointerType: "pen" });
	let s = await state();
	assert.equal(s.toggle, null, "ohne Band kein Aufdecken-Knopf");
	await click('.markdown-source-view .ink-toolbar [data-tool="tape"]');
	await h.draw(Array.from({ length: 20 }, (_, i) => [r.x + 90 + i * 12, r.y + 82 + 3 * Math.sin(i), 0.5]), { pointerType: "pen" });
	await h.sleep(150);
	s = await state();
	assert.deepEqual(s.strokes[1], { tool: "tape", color: 6, size: 36, ys: 1 });
	assert.deepEqual(s.tapes, [false]);
	assert.equal(s.toggle, false);
	// Band-Ebene liegt über den Kacheln und wird nicht multipliziert (deckt auch auf Arbeitsblättern)
	const layer = await h.evaluate((sel) => {
		const el = document.querySelector(sel);
		const kids = [...el.children];
		const tape = el.querySelector(".ink-tape-layer");
		return { above: kids.indexOf(tape) > kids.indexOf(el.querySelector(".ink-tiles")), blend: getComputedStyle(tape).mixBlendMode };
	}, surface);
	assert.deepEqual(layer, { above: true, blend: "normal" });

	// 2. Tippen mit dem Stift (Werkzeug Stift) deckt auf und wieder zu
	await click('.markdown-source-view .ink-toolbar [data-tool="pen"]');
	await tap(200, 82);
	s = await state();
	assert.deepEqual(s.tapes, [true]);
	assert.equal(s.toggle, true, "alle aufgedeckt");
	assert.equal(s.strokes.length, 2, "Tippen zeichnet keinen Punkt");
	await tap(200, 82);
	assert.deepEqual((await state()).tapes, [false]);

	// 3. Leisten-Knopf: alle auf, alle zu
	await click(".markdown-source-view .ink-tb-tape-toggle");
	assert.deepEqual((await state()).tapes, [true]);
	await click(".markdown-source-view .ink-tb-tape-toggle");
	assert.deepEqual((await state()).tapes, [false]);

	// 4. Auf dem Band ansetzen und ziehen → normaler Strich, Band bleibt zu
	await h.draw(Array.from({ length: 12 }, (_, i) => [r.x + 150 + i * 8, r.y + 82 + i * 6, 0.6]), { pointerType: "pen" });
	await h.sleep(150);
	s = await state();
	assert.equal(s.strokes.length, 3);
	assert.equal(s.strokes[2].tool, "pen");
	assert.deepEqual(s.tapes, [false]);
	await h.screenshot("m18-tape.png");

	// 5. Aufgedeckt bleibt nur für die Sitzung: steht nicht in der Datei
	await tap(120, 82);
	const saved = await h.evaluate(async ([id, sel]) => {
		const el = document.querySelector(sel);
		const store = app.plugins.plugins[id].store;
		const e = store.entries.get(el.dataset.path);
		e.save?.run?.();
		await new Promise((r) => setTimeout(r, 300));
		return app.vault.adapter.read(el.dataset.path);
	}, [ID, surface]);
	assert.match(saved, /"t":"tape"/);
	assert.doesNotMatch(saved, /revealed/);
};
