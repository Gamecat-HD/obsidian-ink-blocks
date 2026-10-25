// M17: Radierer – Kreis-Cursor in Radierergröße, präziser Modus teilt Striche (eine Op, Undo/Redo exakt),
// drei Größen, „nur Textmarker“ lässt die Schrift stehen.
import assert from "node:assert/strict";
const ID = "obsidian-ink-blocks";
const CTRL = 2;
const SHIFT = 8;

export default async (h) => {
	const key = (k, modifiers = 0) => h.key(k, { code: `Key${k.toUpperCase()}`, modifiers });
	await h.evaluate(async () => {
		await app.workspace.getLeaf().openFile(app.vault.getFileByPath("Notiz.md"), { state: { mode: "source", source: false } });
		app.workspace.activeEditor.editor.setCursor({ line: 3, ch: 0 });
		app.commands.executeCommandById("obsidian-ink-blocks:insert-notebook");
	});
	await h.sleep(800);
	const surface = ".markdown-source-view .ink-surface";
	const r = await h.evaluate((sel) => { const b = document.querySelector(sel).getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width }; }, surface);
	const scale = r.w / 1000;
	const strokes = () =>
		h.evaluate(([id, sel]) => {
			const el = document.querySelector(sel);
			return app.plugins.plugins[id].store.entries.get(el.dataset.path).doc.strokes.map((s) => ({
				id: s.id, tool: s.tool, n: s.points.length / 3,
				minX: Math.min(...s.points.filter((_, i) => i % 3 === 0)), maxX: Math.max(...s.points.filter((_, i) => i % 3 === 0)),
			}));
		}, [ID, surface]);
	const click = async (sel) => {
		const p = await h.evaluate((sel) => { const b = document.querySelector(sel).getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; }, sel);
		await h.cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: p.x, y: p.y });
		await h.sleep(150);
		await h.click(p.x, p.y);
		await h.sleep(150);
	};
	const menuItem = async (title) => {
		const p = await h.evaluate((title) => {
			const item = [...document.querySelectorAll(".menu .menu-item")].find((e) => e.textContent.includes(title));
			const b = item.getBoundingClientRect();
			return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
		}, title);
		await h.click(p.x, p.y);
		await h.sleep(150);
	};
	const hline = (y, x0 = 100, x1 = 600) => Array.from({ length: 26 }, (_, i) => [r.x + x0 + ((x1 - x0) * i) / 25, r.y + y, 0.6]);
	const vline = (x, y0, y1) => Array.from({ length: 12 }, (_, i) => [r.x + x, r.y + y0 + ((y1 - y0) * i) / 11, 0.5]);

	// 1. Ein langer Stift-Strich
	await h.draw(hline(80), { pointerType: "pen" });
	await h.sleep(100);
	const [orig] = await strokes();

	// 2. Radierer: Kreis-Cursor beim Schweben, Durchmesser = 2 × Radius (Slot „mittel“ = 10)
	await click('.markdown-source-view .ink-toolbar [data-tool="eraser"]');
	await h.cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: r.x + 300, y: r.y + 200 });
	await h.sleep(100);
	const cursor = await h.evaluate((sel) => {
		const c = document.querySelector(`${sel} .ink-eraser-cursor`);
		return c && c.style.display !== "none" ? c.getBoundingClientRect().width : 0;
	}, surface);
	assert.ok(Math.abs(cursor - 20 * scale) < 1.5, `Cursor ${cursor} statt ${20 * scale}`);

	// 3. Nochmal auf den Radierer → Menü → präzise
	await click('.markdown-source-view .ink-toolbar [data-tool="eraser"]');
	await menuItem("Präzise");
	assert.equal(await h.evaluate((id) => app.plugins.plugins[id].settings.eraserMode, ID), "precise");

	// 4. Senkrecht durch die Mitte radieren → zwei Stücke, links und rechts der Lücke
	await h.draw(vline(350, 50, 110), { pointerType: "pen" });
	await h.sleep(150);
	let s = await strokes();
	assert.equal(s.length, 2, `Stücke: ${JSON.stringify(s)}`);
	assert.ok(!s.some((x) => x.id === orig.id));
	const gapL = s[0].maxX;
	const gapR = s[1].minX;
	const mid = 350 / scale;
	assert.ok(gapL < mid && gapR > mid, `Lücke ${gapL}..${gapR} um ${mid}`);

	// 5. Undo = Original, Redo = dieselben Stücke
	await key("z", CTRL);
	await h.sleep(100);
	assert.deepEqual((await strokes()).map((x) => x.id), [orig.id]);
	await key("z", CTRL | SHIFT);
	await h.sleep(100);
	assert.deepEqual((await strokes()).map((x) => x.id), s.map((x) => x.id));

	// 6. Größe „breit“ → größerer Cursor; „nur Textmarker“: Strich überlebt, Marker darunter wird geteilt
	await click(".markdown-source-view .ink-tb-width:nth-child(3)");
	assert.equal(await h.evaluate((id) => app.plugins.plugins[id].settings.tools.eraserWidth, ID), 2);
	await click('.markdown-source-view .ink-toolbar [data-tool="hl"]');
	await h.draw(hline(80, 100, 600), { pointerType: "pen" });
	await h.sleep(100);
	await click('.markdown-source-view .ink-toolbar [data-tool="eraser"]');
	await click('.markdown-source-view .ink-toolbar [data-tool="eraser"]');
	await menuItem("Nur Textmarker");
	await h.draw(vline(200, 50, 110), { pointerType: "pen" });
	await h.sleep(150);
	s = await strokes();
	assert.equal(s.filter((x) => x.tool === "pen").length, 2, "Stift-Stücke unberührt");
	assert.equal(s.filter((x) => x.tool === "hl").length, 2, "Textmarker geteilt");
	await h.screenshot("m17-eraser.png");

	// 7. Zurück auf „ganze Striche“: ein Wisch entfernt ganze Striche
	await click('.markdown-source-view .ink-toolbar [data-tool="eraser"]');
	await menuItem("Ganze Striche");
	await click('.markdown-source-view .ink-toolbar [data-tool="eraser"]');
	await menuItem("Nur Textmarker");
	await h.draw(vline(150, 50, 110), { pointerType: "pen" });
	await h.sleep(150);
	s = await strokes();
	assert.equal(s.length, 2, `nach ganzem Radieren: ${JSON.stringify(s)}`);
};
