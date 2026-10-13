// M8: Live-Strich ohne desynchronized-Canvas, Ausklappen (große Fläche im Dialog, Undo, Esc),
// eingebettete Bilder/PDFs beschriften (Hover-Button und Befehl, auch mitten im Text).
import assert from "node:assert/strict";
const ID = "obsidian-ink-blocks";

export default async (h) => {
	h.evalTimeout = 60000;
	const editorText = () => h.evaluate(() => app.workspace.activeEditor.editor.getValue());
	const strokes = (p) => h.evaluate((id, p) => app.plugins.plugins[id].store.entries.get(p)?.doc.strokes.length ?? -1, ID, p);
	const move = (x, y) => h.cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });

	await h.evaluate(async () => {
		await app.workspace.getLeaf().openFile(app.vault.getFileByPath("Notiz.md"), { state: { mode: "source", source: false } });
		app.workspace.activeEditor.editor.setCursor({ line: 3, ch: 0 });
		app.commands.executeCommandById("obsidian-ink-blocks:insert-notebook");
	});
	await h.sleep(800);
	const block = await h.evaluate(() => {
		const el = document.querySelector(".markdown-source-view .ink-surface");
		const r = el.getBoundingClientRect();
		return { x: r.x, y: r.y, w: r.width, path: el.dataset.path };
	});

	// 1. Live-Canvas ohne desynchronized
	assert.equal(await h.evaluate(() => document.querySelector(".ink-live").getContext("2d").getContextAttributes().desynchronized), false);

	// 2. Ausklappen
	await move(block.x + block.w - 80, block.y + 30);
	await h.sleep(200);
	const exp = await h.evaluate(() => { const r = document.querySelector(".markdown-source-view .ink-tb-expand").getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
	await move(exp.x, exp.y);
	await h.sleep(150);
	await h.click(exp.x, exp.y);
	await h.sleep(600);
	const big = await h.evaluate(() => {
		const el = document.querySelector(".ink-expanded-modal .ink-surface");
		const r = el?.getBoundingClientRect();
		return el ? { x: r.x, y: r.y, w: r.width, toolbar: getComputedStyle(document.querySelector(".ink-expanded-modal .ink-toolbar")).opacity } : null;
	});
	assert.ok(big, "Dialog/Fläche fehlt");
	assert.ok(big.w > block.w * 1.4, `nicht größer: ${big.w} vs ${block.w}`);
	assert.equal(big.toolbar, "1", "Leiste im Dialog nicht sichtbar");
	const line = (y, x0 = 0.1, x1 = 0.5) => Array.from({ length: 15 }, (_, i) => [big.x + big.w * (x0 + ((x1 - x0) * i) / 14), big.y + y, 0.5]);
	await h.draw(line(80));
	await h.draw(line(160));
	assert.equal(await strokes(block.path), 2);
	await h.key("z", { code: "KeyZ", modifiers: 2 });
	assert.equal(await strokes(block.path), 1, "Strg+Z im Dialog");
	await h.screenshot("m8-expanded.png");
	await h.key("Escape", { code: "Escape" });
	await h.sleep(400);
	assert.equal(await h.evaluate(() => !!document.querySelector(".ink-expanded-modal")), false, "Dialog nicht geschlossen");
	// Block in der Notiz zeigt den Strich: Position skaliert von groß auf klein
	const k = block.w / big.w;
	const inked = await h.evaluate((x, y) => {
		for (const c of document.querySelectorAll(".markdown-source-view .ink-tile")) {
			const r = c.getBoundingClientRect();
			if (y < r.top || y > r.bottom || !c.width) continue;
			const s = c.width / r.width;
			const d = c.getContext("2d").getImageData(Math.round((x - r.left) * s) - 3, Math.round((y - r.top) * s) - 3, 7, 7).data;
			for (let i = 3; i < d.length; i += 4) if (d[i] > 0) return true;
		}
		return false;
	}, block.x + block.w * 0.3, block.y + 80 * k);
	assert.ok(inked, "Strich aus dem Dialog nicht im Block");
	const undoInNote = await editorText();
	assert.doesNotMatch(undoInNote, /XYZ/); // Notiztext unberührt

	// 3. Eingebettete Bilder/PDFs beschriften
	await h.evaluate(async () => {
		const c = document.createElement("canvas");
		c.width = 400;
		c.height = 300;
		const g = c.getContext("2d");
		g.fillStyle = "#fff";
		g.fillRect(0, 0, 400, 300);
		g.fillStyle = "#06c";
		g.fillRect(20, 20, 360, 40);
		const blob = await new Promise((r) => c.toBlob(r, "image/png"));
		await app.vault.createFolder("bilder");
		await app.vault.createBinary("bilder/blatt.png", await blob.arrayBuffer());
		const f = await app.vault.create("Embeds.md", "# Embeds\n\nText davor.\n![[bilder/blatt.png]]\n\nMitte ![[Arbeitsblatt.pdf]] Ende\n\n![[bilder/blatt.png|200]]\n");
		await app.workspace.getLeaf().openFile(f, { state: { mode: "source", source: false } });
		app.workspace.activeEditor.editor.setCursor({ line: 0, ch: 0 });
	});
	await h.sleep(1500);

	// 3a. Bild per Hover-Button
	const img = await h.evaluate(() => { const r = document.querySelector(".markdown-source-view .internal-embed.image-embed").getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, right: r.right, top: r.top }; });
	await move(img.x, img.y);
	await h.sleep(300);
	const btn = await h.evaluate(() => { const b = document.querySelector(".markdown-source-view .ink-embed-annotate"); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, opacity: getComputedStyle(b).opacity }; });
	assert.ok(btn, "Beschriften-Button fehlt");
	await move(btn.x, btn.y);
	await h.click(btn.x, btn.y);
	await h.sleep(1000);
	let text = await editorText();
	assert.match(text, /Text davor\.\n\n```ink\nfile: \S+\nbg: "\[\[blatt\.png\]\]"\n```\n\nMitte/, text);
	assert.doesNotMatch(text.split("Mitte")[0], /!\[\[bilder\/blatt\.png\]\]/);

	// 3b. PDF mitten im Text per Befehl → Seite 2 wählen
	await h.evaluate(() => {
		const ed = app.workspace.activeEditor.editor;
		const line = ed.getValue().split("\n").findIndex((l) => l.startsWith("Mitte"));
		ed.setCursor({ line, ch: 0 });
		app.commands.executeCommandById("obsidian-ink-blocks:annotate-embed");
	});
	await h.sleep(800);
	assert.deepEqual(await h.evaluate(() => [...document.querySelectorAll(".suggestion-item")].map((e) => e.textContent)), ["Alle Seiten (2)", "Seite 1", "Seite 2"]);
	await h.cdp.send("Input.insertText", { text: "Seite 2" });
	await h.sleep(200);
	await h.key("Enter", { code: "Enter" });
	await h.sleep(1200);
	text = await editorText();
	assert.match(text, /Mitte\n\n```ink\nfile: \S+\nbg: "\[\[Arbeitsblatt\.pdf#page=2\]\]"\n```\n\nEnde/, text);

	// 3c. Abbrechen ändert nichts
	const beforeCancel = await editorText();
	await h.evaluate(() => {
		const ed = app.workspace.activeEditor.editor;
		const v = ed.getValue() + "\n![[Arbeitsblatt.pdf]]\n";
		ed.setValue(v);
		ed.setCursor({ line: v.split("\n").length - 2, ch: 0 });
		app.commands.executeCommandById("obsidian-ink-blocks:annotate-embed");
	});
	await h.sleep(600);
	await h.key("Escape", { code: "Escape" });
	await h.sleep(500);
	assert.match(await editorText(), /\n!\[\[Arbeitsblatt\.pdf\]\]\n$/, "Abbruch hat die Notiz verändert");
	void beforeCancel;

	// 4. Ausgeklapptes Arbeitsblatt: PDF-Seite groß und scharf
	await h.evaluate(() => app.workspace.activeEditor.editor.setCursor({ line: 0, ch: 0 }));
	await h.sleep(500);
	const ws = await h.evaluate(() => {
		const el = [...document.querySelectorAll(".markdown-source-view .ink-surface")].find((s) => s.dataset.space === "page" && s.querySelector(".ink-bg-canvas"));
		el.scrollIntoView({ block: "center" });
		return el.dataset.path;
	});
	await h.sleep(500);
	const wsRect = await h.evaluate((p) => { const r = document.querySelector(`.markdown-source-view .ink-surface[data-path="${p}"]`).getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width }; }, ws);
	await move(wsRect.x + wsRect.w - 80, wsRect.y + 40);
	await h.sleep(200);
	const exp2 = await h.evaluate((p) => {
		const block = document.querySelector(`.markdown-source-view .ink-surface[data-path="${p}"]`).closest(".ink-block");
		const r = block.querySelector(".ink-tb-expand").getBoundingClientRect();
		return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
	}, ws);
	await move(exp2.x, exp2.y);
	await h.click(exp2.x, exp2.y);
	await h.sleep(1200);
	const bgBig = await h.evaluate(() => {
		const s = document.querySelector(".ink-expanded-modal .ink-surface");
		const c = s?.querySelector(".ink-bg-canvas");
		return c ? { canvasW: c.width, inner: s.clientWidth, dpr: window.devicePixelRatio } : null;
	});
	assert.ok(bgBig, "kein PDF-Hintergrund im Dialog");
	assert.equal(bgBig.canvasW, Math.round(bgBig.inner * bgBig.dpr), "PDF im Dialog nicht in voller Auflösung");
	await h.screenshot("m8-worksheet-expanded.png");
	await h.key("Escape", { code: "Escape" });
};
