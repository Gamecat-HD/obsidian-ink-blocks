// M14: Zeilenabstand per Schieberegler (Vorschau, Esc verwirft, Fertig speichert), Handballen auf der Fläche
// blockiert den Stift nicht, Wachsen mitten im Strich legt die Kachel nicht neu an, Leiste der
// ausgeklappten Ansicht folgt Werkzeugwechseln.
import assert from "node:assert/strict";
const ID = "obsidian-ink-blocks";

export default async (h) => {
	await h.evaluate(async () => {
		await app.workspace.getLeaf().openFile(app.vault.getFileByPath("Notiz.md"), { state: { mode: "source", source: false } });
		app.workspace.activeEditor.editor.setCursor({ line: 3, ch: 0 });
		app.commands.executeCommandById("obsidian-ink-blocks:insert-notebook");
	});
	await h.sleep(800);

	const state = () =>
		h.evaluate((id) => {
			const el = document.querySelector(".markdown-source-view .ink-surface");
			const r = el.getBoundingClientRect();
			const entry = app.plugins.plugins[id].store.entries.get(el.dataset.path);
			return {
				rect: { x: r.x, y: r.y, w: r.width, h: r.height },
				strokes: entry.doc.strokes.length,
				docH: entry.doc.h,
				gap: el.dataset.gap,
				text: app.workspace.activeEditor.editor.getValue(),
			};
		}, ID);
	const center = (sel) =>
		h.evaluate((sel) => {
			const b = document.querySelector(sel);
			if (!b) return null;
			const r = b.getBoundingClientRect();
			return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
		}, sel);
	const hoverClick = async (sel) => {
		const s = await state();
		await h.cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: s.rect.x + s.rect.w - 60, y: s.rect.y + 20 });
		await h.sleep(150);
		const p = await center(sel);
		assert.ok(p, `${sel} fehlt`);
		await h.cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: p.x, y: p.y });
		await h.sleep(200);
		await h.click(p.x, p.y);
		await h.sleep(250);
	};
	const menuItem = async (re) => {
		const p = await h.evaluate((src) => {
			const item = [...document.querySelectorAll(".menu .menu-item")].find((i) => new RegExp(src).test(i.textContent.trim()));
			if (!item) return [...document.querySelectorAll(".menu .menu-item")].map((i) => i.textContent.trim());
			const r = item.getBoundingClientRect();
			return { x: r.x + r.width / 2, y: r.y + r.height / 2, icon: !!item.querySelector("svg") };
		}, re.source);
		assert.ok(p.x !== undefined, `Menüpunkt ${re} fehlt: ${JSON.stringify(p)}`);
		return p;
	};
	const slide = (v) =>
		h.evaluate((v) => {
			const s = document.querySelector(".ink-gap-popover .ink-gap-slider");
			s.value = String(v);
			s.dispatchEvent(new Event("input", { bubbles: true }));
		}, v);

	// 1. Schieberegler: Vorschau ohne Schreiben, Esc verwirft
	const textBefore = (await state()).text;
	await hoverClick(".markdown-source-view .ink-tb-button[data-bg]");
	const item = await menuItem(/^Zeilenabstand einstellen … \(40\)$/);
	assert.ok(item.icon, "Icon des Menüpunkts fehlt");
	await h.click(item.x, item.y);
	await h.sleep(250);
	assert.ok(await h.evaluate(() => !!document.querySelector(".ink-gap-popover")), "Popover fehlt");
	await slide(62);
	let s = await state();
	assert.equal(s.gap, "62", "keine Vorschau");
	assert.equal(s.text, textBefore, "Vorschau hat den Block geschrieben");
	assert.match(await h.evaluate(() => document.querySelector(".ink-gap-value").textContent), /^62$/);
	await h.screenshot("m14-gap-popover.png");
	await h.key("Escape", { code: "Escape" });
	await h.sleep(250);
	s = await state();
	assert.equal(s.gap, "40", "Esc hat die Vorschau nicht verworfen");
	assert.equal(s.text, textBefore);
	assert.equal(await h.evaluate(() => !!document.querySelector(".ink-gap-popover")), false);

	// 2. Fertig speichert gap und den Stil
	await hoverClick(".markdown-source-view .ink-tb-button[data-bg]");
	const item2 = await menuItem(/^Zeilenabstand einstellen/);
	await h.click(item2.x, item2.y);
	await h.sleep(250);
	await slide(62);
	const done = await center(".ink-gap-popover .mod-cta");
	await h.click(done.x, done.y);
	await h.sleep(600);
	s = await state();
	assert.match(s.text, /```ink\nfile: [^\n]+\n(bgStyle: ruled\ngap: 62|gap: 62\nbgStyle: ruled)\n```/, s.text);
	assert.equal(s.gap, "62");

	// 3. Standard setzt zurück (Klick daneben übernimmt)
	await hoverClick(".markdown-source-view .ink-tb-button[data-bg]");
	const item3 = await menuItem(/^Zeilenabstand einstellen … \(62\)$/);
	await h.click(item3.x, item3.y);
	await h.sleep(250);
	const reset = await center(".ink-gap-actions button:not(.mod-cta)");
	await h.click(reset.x, reset.y);
	s = await state();
	await h.click(s.rect.x + s.rect.w / 2, s.rect.y - 120); // daneben (Text über dem Block)
	await h.sleep(600);
	s = await state();
	assert.doesNotMatch(s.text, /gap:/, "Standard hat gap nicht entfernt");
	assert.equal(s.gap, "40");

	// 4. Handballen liegt auf der Fläche, dann schreibt der Stift → Strich kommt an
	s = await state();
	const n0 = s.strokes;
	const { x, y, w } = s.rect;
	await h.cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: x + w * 0.8, y: y + 200, radiusX: 20, radiusY: 20 }] });
	await h.sleep(100);
	await h.draw(Array.from({ length: 20 }, (_, i) => [x + w * (0.1 + i * 0.02), y + 80 + 5 * Math.sin(i), 0.5]), { pointerType: "pen" });
	await h.cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
	await h.sleep(200);
	s = await state();
	assert.equal(s.strokes, n0 + 1, "Stift bei aufliegendem Handballen ignoriert");

	// 5. Wachsen mitten im Strich: die unterste Kachel bleibt dieselbe (kein leerer Frame), Tinte bleibt
	const tileMark = () =>
		h.evaluate(() => {
			const tiles = [...document.querySelectorAll(".markdown-source-view .ink-tile")];
			tiles.forEach((t, i) => (t.dataset.mark ??= `t${i}`));
			return tiles.map((t) => t.dataset.mark);
		});
	const before = await tileMark();
	const h0 = s.docH;
	const bottom = s.rect.y + s.rect.h;
	const ev = (type, px, py, extra = {}) =>
		h.cdp.send("Input.dispatchMouseEvent", { type, x: px, y: py, button: "left", buttons: 1, clickCount: 1, pointerType: "pen", force: 0.5, ...extra });
	await ev("mouseMoved", x + w * 0.5, bottom - 150, { button: "none", buttons: 0 });
	await ev("mousePressed", x + w * 0.5, bottom - 150);
	for (let i = 1; i <= 15; i++) await ev("mouseMoved", x + w * 0.5 + i, bottom - 150 + i * 8);
	const mid = await h.evaluate((id) => {
		const el = document.querySelector(".markdown-source-view .ink-surface");
		const entry = app.plugins.plugins[id].store.entries.get(el.dataset.path);
		const tiles = [...document.querySelectorAll(".markdown-source-view .ink-tile")];
		// Tinte des alten Strichs (Abschnitt 4) muss sofort noch auf der Kachel sein.
		const c = tiles[0];
		const d = c.getContext("2d").getImageData(0, 0, c.width, Math.min(c.height, 200)).data;
		let ink = 0;
		for (let i = 3; i < d.length; i += 4) if (d[i] > 0) ink++;
		return { docH: entry.doc.h, marks: tiles.map((t) => t.dataset.mark ?? null), ink, height: c.style.height };
	}, ID);
	await ev("mouseReleased", x + w * 0.5 + 15, bottom - 150 + 120, { buttons: 0 });
	await h.sleep(200);
	assert.ok(mid.docH > h0, `nicht gewachsen (${mid.docH})`);
	assert.equal(mid.marks[0], before[0], `Kachel neu angelegt: ${JSON.stringify(mid.marks)}`);
	assert.ok(mid.ink > 20, `Tinte nach dem Wachsen weg (${mid.ink} px)`);

	// 6. Ausgeklappt: Werkzeugwechsel aktualisiert die Leiste sofort
	await hoverClick(".markdown-source-view .ink-tb-expand");
	await h.sleep(400);
	const hl = await center(".ink-expanded-modal .ink-tb-button[data-tool='hl']");
	await h.click(hl.x, hl.y);
	await h.sleep(150);
	const exp = await h.evaluate(() => {
		const m = document.querySelector(".ink-expanded-modal");
		return {
			hlActive: m.querySelector(".ink-tb-button[data-tool='hl']").classList.contains("is-active"),
			straightShown: getComputedStyle(m.querySelector(".ink-tb-straight")).display !== "none",
		};
	});
	assert.ok(exp.hlActive && exp.straightShown, `Leiste im Dialog nicht aktualisiert: ${JSON.stringify(exp)}`);
	await h.evaluate((id) => {
		app.plugins.plugins[id].settings.tools.tool = "pen";
		document.querySelector(".ink-expanded-modal .modal-close-button")?.click();
	}, ID);
};
