// Spike S2 (pdf.js über loadPdfJs) und S4 (Re-Render des Blocks in Live Preview)
import assert from "node:assert/strict";
const ID = "obsidian-ink-blocks";

export default async (h) => {
	// ---- S2 ----
	const s2 = await h.evaluate(async (id) => {
		const pdfjs = await app.plugins.plugins[id].dev.loadPdfJs();
		const file = app.vault.getFileByPath("Arbeitsblatt.pdf");
		const data = await app.vault.readBinary(file);
		const doc = await pdfjs.getDocument({ data }).promise;
		const page = await doc.getPage(1);
		const vp = page.getViewport({ scale: 1 });
		const canvas = document.createElement("canvas");
		canvas.width = vp.width; canvas.height = vp.height;
		const res = { version: pdfjs.version, workerSrc: String(pdfjs.GlobalWorkerOptions?.workerSrc ?? ""), pages: doc.numPages, w: vp.width, h: vp.height };
		try {
			await page.render({ canvasContext: canvas.getContext("2d"), viewport: vp }).promise;
			res.renderCtx = "ok";
		} catch (e) { res.renderCtx = String(e); }
		try {
			const c2 = document.createElement("canvas"); c2.width = vp.width; c2.height = vp.height;
			await page.render({ canvas: c2, viewport: vp }).promise;
			res.renderCanvas = "ok";
		} catch (e) { res.renderCanvas = String(e); }
		const px = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
		let dark = 0; for (let i = 0; i < px.length; i += 4) if (px[i + 3] > 0 && px[i] < 128) dark++;
		res.darkPixels = dark;
		try {
			const off = new OffscreenCanvas(vp.width, vp.height);
			await page.render({ canvasContext: off.getContext("2d"), viewport: vp }).promise;
			res.offscreen = "ok";
		} catch (e) { res.offscreen = String(e); }
		return res;
	}, ID);
	console.log("S2", JSON.stringify(s2));
	assert.equal(s2.pages, 2);

	// ---- S4 ----
	await h.evaluate(async () => {
		const leaf = app.workspace.getLeaf();
		await leaf.openFile(app.vault.getFileByPath("Block.md"), { state: { mode: "source", source: false } });
	});
	await h.sleep(800);
	const before = await h.evaluate((id) => ({ ...app.plugins.plugins[id].dev, inst: document.querySelector(".ink-block")?.dataset.instance }), ID);
	// a) Edit außerhalb des Blocks
	await h.evaluate(() => { const ed = app.workspace.activeEditor.editor; ed.replaceRange("X", { line: 2, ch: 0 }); });
	await h.sleep(500);
	const afterOutside = await h.evaluate((id) => ({ ...app.plugins.plugins[id].dev, inst: document.querySelector(".ink-block")?.dataset.instance }), ID);
	// b) Edit innerhalb des Blocks (text:-Zeile), Cursor bleibt außerhalb
	await h.evaluate(() => { const ed = app.workspace.activeEditor.editor; const l = ed.getLine(7); ed.replaceRange("  neu", { line: 7, ch: 0 }, { line: 7, ch: l.length }); });
	await h.sleep(500);
	const afterInside = await h.evaluate((id) => ({ ...app.plugins.plugins[id].dev, inst: document.querySelector(".ink-block")?.dataset.instance, cursor: app.workspace.activeEditor.editor.getCursor() }), ID);
	// c) Klick in den Block → springt LP in den Quelltext?
	const r = await h.evaluate(() => { const b = document.querySelector(".ink-block").getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; });
	await h.click(r.x, r.y);
	await h.sleep(500);
	const afterClick = await h.evaluate(() => ({ stub: !!document.querySelector(".ink-block"), cursor: app.workspace.activeEditor.editor.getCursor() }));
	await h.screenshot("spike-s4.png");
	console.log("S4", JSON.stringify({ before, afterOutside, afterInside, afterClick }));
};
