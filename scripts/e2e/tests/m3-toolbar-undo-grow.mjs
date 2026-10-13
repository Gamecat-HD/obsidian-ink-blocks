// M3: Werkzeugleiste, Undo/Redo (Button + Strg+Z nur bei aktivem Block), Undo übersteht Re-Render,
// Hintergrund umschalten, Auto-Grow (+ Undo schrumpft), Notiz mit 10 Blöcken öffnet schnell.
import assert from "node:assert/strict";
const ID = "obsidian-ink-blocks";
const CTRL = 2;
const SHIFT = 8;

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
			const plugin = app.plugins.plugins[id];
			const entry = plugin.store.entries.get(el.dataset.path);
			return {
				rect: { x: r.x, y: r.y, w: r.width, h: r.height },
				strokes: entry.doc.strokes.length,
				docH: entry.doc.h,
				tools: { ...plugin.settings.tools },
				bg: el.dataset.bg,
				text: app.workspace.activeEditor.editor.getValue(),
				active: !!document.querySelector(".markdown-source-view .ink-block.is-active"),
			};
		}, ID);
	const btn = (sel) =>
		h.evaluate((sel) => {
			const b = document.querySelector(`.markdown-source-view .ink-toolbar ${sel}`);
			const r = b.getBoundingClientRect();
			return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
		}, sel);
	const clickBtn = async (sel) => {
		// Wie ein Nutzer: erst über die Fläche, dann hoch auf die Leiste (die über der Oberkante schwebt).
		const surf = await h.evaluate(() => { const r = document.querySelector(".markdown-source-view .ink-surface").getBoundingClientRect(); return { x: r.x + r.width - 60, y: r.y + 20 }; });
		await h.cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: surf.x, y: surf.y });
		await h.sleep(150);
		const p = await btn(sel);
		await h.cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: p.x, y: p.y });
		await h.sleep(200);
		await h.click(p.x, p.y);
		await h.sleep(80);
	};
	const key = (k, modifiers) => h.key(k, { code: `Key${k.toUpperCase()}`, modifiers });

	let s = await state();
	const { x, y, w } = s.rect;

	// 1. Leiste erscheint beim Hovern; alle Icons vorhanden
	await h.cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: x + w / 2, y: y + 50 });
	await h.sleep(250);
	const tb = await h.evaluate(() => {
		const bar = document.querySelector(".markdown-source-view .ink-toolbar");
		const buttons = [...bar.querySelectorAll(".ink-tb-button")];
		return { opacity: getComputedStyle(bar).opacity, missingIcons: buttons.filter((b) => !b.querySelector("svg")).length, n: buttons.length };
	});
	assert.equal(tb.opacity, "1", "Leiste beim Hovern unsichtbar");
	assert.equal(tb.missingIcons, 0, "Icons fehlen");
	// Leiste liegt über der Oberkante, nicht auf der Schreibfläche; keine Überdeckung mit „Block bearbeiten“
	const above = await h.evaluate(() => {
		const bar = document.querySelector(".markdown-source-view .ink-toolbar").getBoundingClientRect();
		const surf = document.querySelector(".markdown-source-view .ink-surface").getBoundingClientRect();
		return bar.bottom <= surf.top + 1;
	});
	assert.ok(above, "Leiste überdeckt die Schreibfläche");
	const overlap = await h.evaluate(() => {
		const edit = document.querySelector(".markdown-source-view .edit-block-button")?.getBoundingClientRect();
		const bar = document.querySelector(".markdown-source-view .ink-toolbar").getBoundingClientRect();
		return edit ? !(bar.right <= edit.left || bar.left >= edit.right || bar.bottom <= edit.top || bar.top >= edit.bottom) : false;
	});
	assert.equal(overlap, false, "Leiste überdeckt den Bearbeiten-Button");
	await h.screenshot("m3-toolbar.png");

	// 2. Werkzeug, Farbe, Breite
	await clickBtn('[data-tool="hl"]');
	await clickBtn(".ink-tb-swatch:nth-child(2)");
	await clickBtn(".ink-tb-width:nth-child(2)");
	s = await state();
	assert.deepEqual([s.tools.tool, s.tools.hlColor, s.tools.hlWidth], ["hl", 4, 1]);
	await clickBtn('[data-tool="pen"]');
	assert.equal((await state()).tools.tool, "pen");

	// 3. Drei Striche, Undo per Button, dann Tasten (Block ist durch das Zeichnen aktiv)
	const textBefore = s.text;
	for (const dy of [40, 80, 120]) {
		await h.draw(Array.from({ length: 10 }, (_, i) => [x + w * (0.1 + i * 0.03), y + dy, 0.5]));
	}
	assert.equal((await state()).strokes, 3);
	await clickBtn(".ink-tb-group:nth-child(4) .ink-tb-button:nth-child(1)");
	assert.equal((await state()).strokes, 2, "Undo-Button");
	await key("z", CTRL);
	assert.equal((await state()).strokes, 1, "Strg+Z");
	await key("z", CTRL | SHIFT);
	assert.equal((await state()).strokes, 2, "Strg+Umschalt+Z");
	await key("y", CTRL);
	s = await state();
	assert.equal(s.strokes, 3, "Strg+Y");
	assert.equal(s.text, textBefore, "Notiztext durch Strg+Z verändert");
	assert.ok(s.active);

	// 4. Klick in den Text → Block inaktiv, Strg+Z wirkt auf den Editor
	const para = await h.evaluate(() => {
		const line = [...document.querySelectorAll(".markdown-source-view .cm-line")].find((l) => l.textContent.includes("Absatz nach"));
		const r = line.getBoundingClientRect();
		return { x: r.x + 200, y: r.y + r.height / 2 };
	});
	await h.click(para.x, para.y);
	await h.sleep(100);
	await h.evaluate(() => app.workspace.activeEditor.editor.focus());
	await h.cdp.send("Input.insertText", { text: "XYZ" });
	await h.sleep(600);
	assert.match((await state()).text, /XYZ/);
	assert.equal((await state()).active, false, "Block nach Klick in den Text noch aktiv");
	await key("z", CTRL);
	await h.sleep(200);
	s = await state();
	assert.doesNotMatch(s.text, /XYZ/, "Strg+Z im Editor hat den Text nicht rückgängig gemacht");
	assert.equal(s.strokes, 3, "Strg+Z im Editor hat Tinte entfernt");

	// 5. Hintergrund-Menü: Stil und Abstand → bgStyle/gap im Block, Re-Render; Undo funktioniert danach weiter
	const loadedBefore = await h.evaluate((id) => app.plugins.plugins[id].dev.loaded, ID);
	const pickMenu = async (title) => {
		await clickBtn(".ink-tb-button[data-bg]");
		await h.sleep(250);
		const p = await h.evaluate((title) => {
			const item = [...document.querySelectorAll(".menu .menu-item")].find((i) => i.textContent.trim() === title);
			if (!item) return [...document.querySelectorAll(".menu .menu-item")].map((i) => i.textContent.trim());
			const r = item.getBoundingClientRect();
			return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
		}, title);
		assert.ok(p.x !== undefined, `Menüpunkt ${title} fehlt: ${JSON.stringify(p)}`);
		await h.click(p.x, p.y);
		await h.sleep(500);
	};
	await pickMenu("Kariert");
	s = await state();
	assert.match(s.text, /```ink\nfile: [^\n]+\nbgStyle: grid\n```/);
	assert.equal(s.bg, "grid");
	assert.ok((await h.evaluate((id) => app.plugins.plugins[id].dev.loaded, ID)) > loadedBefore, "kein Re-Render");
	await pickMenu("Kästchen: Groß");
	s = await state();
	assert.match(s.text, /bgStyle: grid\ngap: 35\n```/);
	assert.equal(await h.evaluate(() => document.querySelector(".markdown-source-view .ink-surface").dataset.gap), "35");
	assert.ok(await h.evaluate(() => !!document.querySelector(".markdown-source-view .ink-tb-button[data-bg] svg")), "Hintergrund-Icon fehlt");
	await h.screenshot("m3-grid-gap.png");
	await pickMenu("Liniert");
	s = await state();
	assert.match(s.text, /```ink\nfile: [^\n]+\nbgStyle: ruled\n```/, "Stilwechsel setzt gap nicht zurück");
	await pickMenu("Kariert");
	await clickBtn(".ink-tb-group:nth-child(4) .ink-tb-button:nth-child(1)");
	assert.equal((await state()).strokes, 2, "Undo nach Re-Render");
	assert.equal(await h.evaluate(() => document.querySelectorAll(".markdown-source-view .ink-tb-width").length), 3, "drei Breiten");

	// 6. Auto-Grow: Strich über den unteren Rand hinaus
	s = await state();
	const h0 = s.docH;
	const bottom = s.rect.y + s.rect.h;
	const pts = Array.from({ length: 40 }, (_, i) => [s.rect.x + w * 0.5, bottom - 140 + i * 8, 0.5]);
	await h.draw(pts, { step: 15 });
	s = await state();
	assert.ok(s.docH > h0, `nicht gewachsen (${s.docH})`);
	assert.ok(s.rect.h > (h0 / 1000) * w + 50, "Fläche nicht höher geworden");
	await h.screenshot("m3-grown.png");
	await key("z", CTRL);
	s = await state();
	assert.equal(s.docH, h0, "Undo schrumpft nicht");
	assert.ok(Math.abs(s.rect.h - (h0 / 1000) * s.rect.w) < 3, `Fläche nach Undo: ${s.rect.h}`);

	// 7. Notiz mit 10 Blöcken à 150 Strichen
	const t = await h.evaluate(async () => {
		const strokes = [];
		for (let i = 0; i < 150; i++) {
			const p = [];
			for (let j = 0; j < 40; j++) p.push(j === 0 ? 300 + (i % 15) * 600 : 40, j === 0 ? 200 + Math.floor(i / 15) * 350 : (j % 2 ? 30 : -30), j === 0 ? 128 : 0);
			strokes.push(JSON.stringify({ id: `s${i}`, t: "pen", c: 0, s: 3, p }));
		}
		const json = `{"v":1,"id":"perf","space":"nb","w":1000,"h":400,"q":10,"strokes":[\n${strokes.join(",\n")}\n]}`;
		let md = "# Viele\n\n";
		for (let b = 0; b < 10; b++) {
			await app.vault.create(`_ink/perf-${b}.ink`, json);
			md += "```ink\nfile: _ink/perf-" + b + ".ink\n```\n\n";
		}
		await app.vault.create("Viele.md", md);
		const t0 = performance.now();
		await app.workspace.getLeaf().openFile(app.vault.getFileByPath("Viele.md"), { state: { mode: "source", source: false } });
		const t1 = performance.now();
		while (document.querySelectorAll(".markdown-source-view .ink-surface").length < 3) await new Promise((r) => setTimeout(r, 10));
		await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
		return { open: t1 - t0, firstSurfaces: performance.now() - t0, surfaces: document.querySelectorAll(".markdown-source-view .ink-surface").length };
	});
	console.log(`  10 Blöcke: openFile ${t.open.toFixed(0)} ms, sichtbare Flächen gezeichnet nach ${t.firstSurfaces.toFixed(0)} ms (${t.surfaces} im DOM)`);
	assert.ok(t.firstSurfaces < 1500, "zu langsam");
	await h.screenshot("m3-many.png");
};
