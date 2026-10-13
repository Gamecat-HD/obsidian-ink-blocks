// M12: Textmarker – Lineal (gerade, waagerecht einrastend, abschaltbar), 6 Farben, 3 Breiten, live unter der
// Schrift; auf Arbeitsblättern multipliziert (gedruckter Text bleibt dunkel).
import assert from "node:assert/strict";
const ID = "obsidian-ink-blocks";

export default async (h) => {
	const enter = () => h.key("Enter", { code: "Enter" });
	await h.evaluate(async () => {
		await app.workspace.getLeaf().openFile(app.vault.getFileByPath("Notiz.md"), { state: { mode: "source", source: false } });
		app.workspace.activeEditor.editor.setCursor({ line: 3, ch: 0 });
		app.commands.executeCommandById("obsidian-ink-blocks:insert-notebook");
	});
	await h.sleep(800);
	const r = await h.evaluate(() => { const b = document.querySelector(".markdown-source-view .ink-surface").getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width }; });
	const strokes = () =>
		h.evaluate((id) => {
			const el = document.querySelector(".markdown-source-view .ink-surface");
			return app.plugins.plugins[id].store.entries.get(el.dataset.path).doc.strokes.map((s) => ({
				tool: s.tool, color: s.color, size: s.size, ys: [...new Set(s.points.filter((_, i) => i % 3 === 1).map((v) => Math.round(v)))].length,
			}));
		}, ID);
	const bar = () =>
		h.evaluate(() => {
			const q = (sel) => document.querySelector(`.markdown-source-view .ink-toolbar ${sel}`);
			const visible = (el) => !!el && getComputedStyle(el).display !== "none";
			return {
				straight: visible(q(".ink-tb-straight")),
				straightActive: !!q(".ink-tb-straight")?.hasClass("is-active"),
				swatches: [...document.querySelectorAll(".markdown-source-view .ink-tb-swatch")].filter(visible).length,
			};
		});
	const clickIn = async (sel) => {
		const p = await h.evaluate((sel) => { const b = document.querySelector(`.markdown-source-view .ink-toolbar ${sel}`).getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; }, sel);
		await h.cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: r.x + r.w - 60, y: r.y + 20 });
		await h.sleep(100);
		await h.cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: p.x, y: p.y });
		await h.sleep(150);
		await h.click(p.x, p.y);
		await h.sleep(100);
	};
	const wobbly = (y0, x0 = 0.15, x1 = 0.7) =>
		Array.from({ length: 25 }, (_, i) => [r.x + r.w * (x0 + ((x1 - x0) * i) / 24), r.y + y0 + 5 * Math.sin(i / 2) + i * 0.4, 0.5]);

	// 1. Stift: 3 Farben, kein Lineal
	assert.deepEqual(await bar(), { straight: false, straightActive: true, swatches: 3 });

	// 2. Textmarker: Lineal sichtbar und aktiv, 6 Farben; Farbe 5 (orange, Index 7), Breite „breit“
	await clickIn('[data-tool="hl"]');
	assert.deepEqual(await bar(), { straight: true, straightActive: true, swatches: 6 });
	await clickIn(".ink-tb-swatch:nth-child(5)");
	await clickIn(".ink-tb-width:nth-child(3)");
	const tools = await h.evaluate((id) => app.plugins.plugins[id].settings.tools, ID);
	assert.deepEqual([tools.hlColor, tools.hlWidth], [7, 2]);

	// 3. Wackelige Linie → gerade und exakt waagerecht
	await h.draw(wobbly(100), { pointerType: "pen" });
	await h.sleep(150);
	let s = await strokes();
	assert.equal(s.length, 1);
	assert.deepEqual([s[0].tool, s[0].color, s[0].size, s[0].ys], ["hl", 7, 40, 1]);

	// 4. Lineal aus → Freihand
	await clickIn(".ink-tb-straight");
	assert.equal((await bar()).straightActive, false);
	await h.draw(wobbly(200), { pointerType: "pen" });
	await h.sleep(150);
	s = await strokes();
	assert.ok(s[1].ys > 5, `Freihand-Textmarker ist gerade (${s[1].ys})`);
	await clickIn(".ink-tb-straight");

	// 5. Stift über dem Textmarker: Stiftfarbe liegt oben (Pixel an der Stiftlinie = Stiftfarbe, nicht orange)
	await clickIn('[data-tool="pen"]');
	await clickIn(".ink-tb-swatch:nth-child(2)"); // blau
	await h.draw(Array.from({ length: 20 }, (_, i) => [r.x + r.w * (0.3 + i * 0.01), r.y + 100, 0.9]), { pointerType: "pen" });
	await h.sleep(150);
	const px = await h.evaluate(([vx, vy]) => {
		for (const c of document.querySelectorAll(".markdown-source-view .ink-tile")) {
			const b = c.getBoundingClientRect();
			if (vy < b.top || vy > b.bottom || !c.width) continue;
			const sx = c.width / b.width;
			return [...c.getContext("2d").getImageData(Math.round((vx - b.left) * sx), Math.round((vy - b.top) * sx), 1, 1).data];
		}
		return null;
	}, [r.x + r.w * 0.4, r.y + 100]);
	assert.ok(px && px[2] > px[0] && px[3] > 200, `Stift nicht über dem Textmarker: ${px}`);
	await h.screenshot("m12-highlighter.png");

	// 6. Arbeitsblatt: Kacheln multiplizieren mit der Seite
	await h.evaluate(() => {
		app.workspace.activeEditor.editor.setCursor({ line: 0, ch: 0 });
		app.commands.executeCommandById("obsidian-ink-blocks:insert-worksheet");
	});
	await h.sleep(300);
	await h.cdp.send("Input.insertText", { text: "Arbeitsblatt" });
	await h.sleep(200);
	await enter();
	await h.sleep(600);
	await h.key("ArrowDown", { code: "ArrowDown" });
	await enter(); // Seite 1
	await h.sleep(1200);
	const blend = await h.evaluate(() => {
		const page = document.querySelector('.markdown-source-view .ink-surface[data-space="page"] .ink-tiles');
		const nb = document.querySelector('.markdown-source-view .ink-surface[data-space="nb"] .ink-tiles');
		return [page && getComputedStyle(page).mixBlendMode, nb && getComputedStyle(nb).mixBlendMode];
	});
	assert.deepEqual(blend, ["multiply", "normal"]);
};
