// M19: Eigene Farben (Farbwähler, je Werkzeug gemerkt, per Rechtsklick entfernen, auch beim Lasso-Umfärben) und
// Punkteraster als Hintergrund (bgStyle: dots).
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
	assert.ok(icons.includes("grip") || icons.includes("lucide-grip"), "Icon fehlt: grip");

	const surface = ".markdown-source-view .ink-surface";
	const r = await h.evaluate((sel) => { const b = document.querySelector(sel).getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width }; }, surface);
	const strokes = () =>
		h.evaluate(([id, sel]) => app.plugins.plugins[id].store.entries.get(document.querySelector(sel).dataset.path).doc.strokes.map((s) => s.color), [ID, surface]);
	const click = async (sel) => {
		const p = await h.evaluate((sel) => { const b = document.querySelector(sel).getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; }, sel);
		await h.cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: p.x, y: p.y });
		await h.sleep(150);
		await h.click(p.x, p.y);
		await h.sleep(150);
		return p;
	};
	const pickColor = (hex) =>
		h.evaluate((hex) => {
			const input = document.querySelector(".markdown-source-view .ink-tb-color-input");
			input.value = hex;
			input.dispatchEvent(new Event("change"));
		}, hex);
	const pixel = (x, y) =>
		h.evaluate(([vx, vy]) => {
			for (const c of document.querySelectorAll(".markdown-source-view .ink-tile")) {
				const b = c.getBoundingClientRect();
				if (vy < b.top || vy > b.bottom || !c.width) continue;
				const sx = c.width / b.width;
				return [...c.getContext("2d").getImageData(Math.round((vx - b.left) * sx), Math.round((vy - b.top) * sx), 1, 1).data];
			}
			return null;
		}, [x, y]);

	// 1. Stift: „+“ → eigene Farbe; wird gewählt und als Knopf gemerkt
	await pickColor("#7048e8");
	await h.sleep(150);
	let tb = await h.evaluate((id) => ({ tools: app.plugins.plugins[id].settings.tools, custom: app.plugins.plugins[id].settings.customColors }), ID);
	assert.equal(tb.tools.penColor, "#7048e8");
	assert.deepEqual(tb.custom.pen, ["#7048e8"]);
	assert.equal(await h.evaluate(() => document.querySelectorAll('.markdown-source-view .ink-tb-swatch.is-custom.is-active[data-color="#7048e8"]').length), 1);

	// 2. Strich in der eigenen Farbe, auch auf der Kachel
	await h.draw(Array.from({ length: 20 }, (_, i) => [r.x + 100 + i * 10, r.y + 80, 1]), { pointerType: "pen" });
	await h.sleep(150);
	assert.deepEqual(await strokes(), ["#7048e8"]);
	const px = await pixel(r.x + 200, r.y + 80);
	assert.ok(px && Math.abs(px[0] - 0x70) < 12 && Math.abs(px[2] - 0xe8) < 12, `Pixel ${px}`);

	// 3. Textmarker hat eigene Liste
	await click('.markdown-source-view .ink-toolbar [data-tool="hl"]');
	assert.equal(await h.evaluate(() => document.querySelectorAll(".markdown-source-view .ink-tb-swatch.is-custom").length), 0);
	await click('.markdown-source-view .ink-toolbar [data-tool="pen"]');

	// 4. Lasso-Umfärben bietet die eigene Farbe an: erst blau, dann zurück auf die eigene
	await click('.markdown-source-view .ink-toolbar [data-tool="lasso"]');
	await h.draw([[60, 40], [360, 40], [360, 120], [60, 120], [60, 42]].map(([x, y]) => [r.x + x, r.y + y, 0.5]), { pointerType: "pen", step: 0 });
	await h.sleep(150);
	await click(".markdown-source-view .ink-selection-bar [data-action=color]");
	await click('.markdown-source-view .ink-selection-color-row[data-kind="pen"] [data-color="1"]');
	assert.deepEqual(await strokes(), [1]);
	await click('.markdown-source-view .ink-selection-color-row[data-kind="pen"] [data-color="#7048e8"]');
	assert.deepEqual(await strokes(), ["#7048e8"]);

	// 5. Rechtsklick auf die eigene Farbe → entfernen; der Stift fällt auf Tinte zurück
	await click('.markdown-source-view .ink-toolbar [data-tool="pen"]');
	const p = await h.evaluate(() => { const b = document.querySelector(".markdown-source-view .ink-tb-swatch.is-custom").getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; });
	for (const type of ["mousePressed", "mouseReleased"]) await h.cdp.send("Input.dispatchMouseEvent", { type, x: p.x, y: p.y, button: "right", buttons: 2, clickCount: 1 });
	await h.sleep(200);
	await click(".menu .menu-item");
	tb = await h.evaluate((id) => ({ tools: app.plugins.plugins[id].settings.tools, custom: app.plugins.plugins[id].settings.customColors }), ID);
	assert.deepEqual(tb.custom.pen, []);
	assert.equal(tb.tools.penColor, 0);

	// 6. Punkteraster über das Hintergrund-Menü → bgStyle: dots im Block, Fläche zeigt Punkte
	const bg = await click(".markdown-source-view .ink-toolbar [data-bg]");
	await h.sleep(150);
	const items = await h.evaluate(() => [...document.querySelectorAll(".menu .menu-item-title")].map((e) => e.textContent));
	assert.ok(items.includes("Punkteraster"), `Menü: ${items}`);
	await h.evaluate(() => [...document.querySelectorAll(".menu .menu-item")].find((e) => e.textContent.includes("Punkteraster")).click());
	await h.sleep(600);
	const dots = await h.evaluate((sel) => {
		const el = document.querySelector(sel);
		return { bg: el.dataset.bg, image: getComputedStyle(el).backgroundImage.startsWith("radial-gradient"), source: app.workspace.activeEditor.editor.getValue() };
	}, surface);
	assert.equal(dots.bg, "dots");
	assert.ok(dots.image);
	assert.match(dots.source, /bgStyle: dots/);
	void bg;
	await h.screenshot("m19-colors-dots.png");
};
