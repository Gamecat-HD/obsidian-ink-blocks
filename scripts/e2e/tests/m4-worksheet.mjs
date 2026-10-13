// M4: Arbeitsblatt einfügen (Dialoge, alle Seiten), PDF-Hintergrund scharf (DPR 1/2), Striche in PDF-Punkten
// bleiben deckungsgleich, fehlender Hintergrund, Bild + Umwandlung eines leeren Hefts, PDF umbenennen.
import assert from "node:assert/strict";
const ID = "obsidian-ink-blocks";

export default async (h) => {
	const enter = () => h.key("Enter", { code: "Enter" });
	const editorText = () => h.evaluate(() => app.workspace.activeEditor.editor.getValue());

	await h.evaluate(async () => {
		await app.workspace.getLeaf().openFile(app.vault.getFileByPath("Notiz.md"), { state: { mode: "source", source: false } });
		app.workspace.activeEditor.editor.setCursor({ line: 3, ch: 0 });
		app.commands.executeCommandById("obsidian-ink-blocks:insert-worksheet");
	});
	await h.sleep(300);
	await h.cdp.send("Input.insertText", { text: "Arbeitsblatt" });
	await h.sleep(200);
	await enter(); // Datei
	await h.sleep(600);
	const pageItems = await h.evaluate(() => [...document.querySelectorAll(".suggestion-item")].map((e) => e.textContent));
	assert.deepEqual(pageItems, ["Alle Seiten (2)", "Seite 1", "Seite 2"]);
	await enter(); // Alle Seiten
	await h.sleep(1200);

	const text = await editorText();
	const blocks = [...text.matchAll(/```ink\nfile: (\S+)\nbg: "\[\[Arbeitsblatt\.pdf#page=(\d)\]\]"\n```/g)];
	assert.equal(blocks.length, 2, `Blöcke:\n${text}`);
	assert.deepEqual(blocks.map((b) => b[2]), ["1", "2"]);
	const [path1] = [blocks[0][1]];
	const doc1 = JSON.parse(await h.evaluate((p) => app.vault.adapter.read(p), path1));
	assert.deepEqual([doc1.space, doc1.w, doc1.h, doc1.bg.page], ["page", 595.28, 841.89, 1]);

	const surf = (i = 0) =>
		h.evaluate((i, id) => {
			const el = document.querySelectorAll(".markdown-source-view .ink-surface")[i];
			const r = el.getBoundingClientRect();
			const c = el.querySelector(".ink-bg-canvas");
			const entry = app.plugins.plugins[id].store.entries.get(el.dataset.path);
			// Anteil dunkler Pixel im Titelbereich der PDF (oben links)
			let dark = 0;
			if (c?.width) {
				const g = c.getContext("2d");
				const d = g.getImageData(0, 0, Math.round(c.width * 0.6), Math.round(c.height * 0.1)).data;
				for (let k = 0; k < d.length; k += 4) if (d[k] < 100 && d[k + 3] > 0) dark++;
			}
			return {
				rect: { x: r.x, y: r.y, w: r.width, h: r.height },
				inner: el.clientWidth,
				space: el.dataset.space,
				canvasW: c?.width ?? 0,
				dark,
				overlay: el.querySelector(".ink-overlay")?.textContent ?? null,
				strokes: entry?.doc.strokes.map((s) => s.points.slice(0, 2)) ?? [],
				dpr: window.devicePixelRatio,
			};
		}, i, ID);

	let s = await surf(0);
	assert.equal(s.space, "page");
	assert.ok(Math.abs(s.rect.h / s.rect.w - 841.89 / 595.28) < 0.01, "Seitenverhältnis");
	assert.equal(s.canvasW, Math.round(s.inner * s.dpr), "PDF nicht in Pixelbreite gerendert");
	assert.ok(s.dark > 200, `PDF-Inhalt fehlt (${s.dark})`);
	assert.equal(s.overlay, null);

	// Strich auf Seite 1: Koordinaten in PDF-Punkten
	await h.draw(Array.from({ length: 12 }, (_, i) => [s.rect.x + s.rect.w * (0.4 + i * 0.01), s.rect.y + s.rect.h * 0.3, 0.5]));
	s = await surf(0);
	assert.ok(Math.abs(s.strokes[0][0] - 595.28 * 0.4) < 1.5, `x in PDF-Punkten: ${s.strokes[0][0]}`);
	assert.ok(Math.abs(s.strokes[0][1] - 841.89 * 0.3) < 1.5, `y in PDF-Punkten: ${s.strokes[0][1]}`);
	await h.screenshot("m4-worksheet.png");

	// Schmaler + DPR 2 → neu gerendert, Strich bleibt an derselben relativen Stelle
	await h.cdp.send("Emulation.setDeviceMetricsOverride", { width: 1000, height: 900, deviceScaleFactor: 2, mobile: false });
	await h.sleep(900);
	s = await surf(0);
	assert.equal(s.dpr, 2);
	assert.equal(s.canvasW, Math.round(s.inner * 2), "nach Resize/DPR nicht neu gerendert");
	const inked = await h.evaluate((x, y) => {
		const c = document.querySelector(".markdown-source-view .ink-surface .ink-tile");
		const r = c.getBoundingClientRect();
		const k = c.width / r.width;
		const d = c.getContext("2d").getImageData(Math.round((x - r.left) * k) - 4, Math.round((y - r.top) * k) - 4, 9, 9).data;
		for (let i = 3; i < d.length; i += 4) if (d[i] > 0) return true;
		return false;
	}, s.rect.x + s.rect.w * 0.45, s.rect.y + s.rect.h * 0.3);
	assert.ok(inked, "Strich nach Resize nicht deckungsgleich");
	await h.cdp.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });

	// Fehlender Hintergrund → klare Meldung, Schreiben bleibt möglich
	await h.evaluate(async () => {
		const ed = app.workspace.activeEditor.editor;
		ed.setValue(ed.getValue().replace("Arbeitsblatt.pdf#page=2", "Fehlt.pdf#page=2"));
	});
	await h.sleep(600);
	s = await surf(1);
	assert.match(s.overlay ?? "", /Hintergrund nicht gefunden: Fehlt\.pdf/);

	// Bild: leeres Heft + bg: → wird zum Arbeitsblatt in Bildgröße
	await h.evaluate(async () => {
		const c = document.createElement("canvas");
		c.width = 400;
		c.height = 300;
		const g = c.getContext("2d");
		g.fillStyle = "#fff";
		g.fillRect(0, 0, 400, 300);
		g.fillStyle = "#c00";
		g.fillRect(20, 20, 360, 40);
		const blob = await new Promise((r) => c.toBlob(r, "image/png"));
		await app.vault.createFolder("bilder");
		await app.vault.createBinary("bilder/blatt.png", await blob.arrayBuffer());
		const ed = app.workspace.activeEditor.editor;
		ed.setCursor({ line: 0, ch: 0 });
		app.commands.executeCommandById("obsidian-ink-blocks:insert-notebook");
	});
	await h.sleep(600);
	await h.evaluate(() => {
		const ed = app.workspace.activeEditor.editor;
		const v = ed.getValue();
		const i = v.indexOf("```ink\nfile:");
		const end = v.indexOf("\n```", i);
		ed.setValue(v.slice(0, end) + '\nbg: "[[blatt.png]]"' + v.slice(end));
	});
	await h.sleep(1000);
	s = await surf(0);
	assert.equal(s.space, "page", "Heft nicht umgewandelt");
	assert.ok(Math.abs(s.rect.h / s.rect.w - 0.75) < 0.01, `Bild-Seitenverhältnis ${s.rect.h / s.rect.w}`);
	assert.ok(await h.evaluate(() => !!document.querySelector(".markdown-source-view .ink-bg-image")), "Bild fehlt");

	// PDF umbenennen → bg:-Links ziehen nach
	await h.evaluate(async () => {
		await app.vault.createFolder("material");
		await app.fileManager.renameFile(app.vault.getFileByPath("Arbeitsblatt.pdf"), "material/IPv6-Blatt.pdf");
	});
	await h.sleep(1200);
	const after = await editorText();
	assert.match(after, /bg: "\[\[IPv6-Blatt\.pdf#page=1\]\]"/, `nach Umbenennen:\n${after}`);
	assert.match(after, /Fehlt\.pdf#page=2/, "fremder Link verändert");
	await h.screenshot("m4-final.png");
};
