// M16: Lasso – einkreisen, verschieben, skalieren, kopieren/einfügen (auch in einen anderen Block), umfärben,
// löschen, alles mit Undo; ausgewählte Striche liegen angehoben in der SVG-Ebene, nicht auf den Kacheln.
import assert from "node:assert/strict";
const ID = "obsidian-ink-blocks";
const CTRL = 2;

export default async (h) => {
	const key = (k, modifiers = 0) => h.key(k, { code: k.length === 1 ? `Key${k.toUpperCase()}` : k, modifiers });
	await h.evaluate(async () => {
		await app.workspace.getLeaf().openFile(app.vault.getFileByPath("Notiz.md"), { state: { mode: "source", source: false } });
		app.workspace.activeEditor.editor.setCursor({ line: 3, ch: 0 });
		app.commands.executeCommandById("obsidian-ink-blocks:insert-notebook");
	});
	await h.sleep(800);
	const icons = await h.evaluate((id) => app.plugins.plugins[id].dev.getIconIds(), ID);
	for (const icon of ["lasso", "copy-plus", "palette", "type", "scissors", "trash-2", "clipboard-paste", "box-select"]) {
		assert.ok(icons.includes(icon) || icons.includes(`lucide-${icon}`), `Icon fehlt: ${icon}`);
	}

	const surface = ".markdown-source-view .ink-surface";
	const r = await h.evaluate((sel) => { const b = document.querySelector(sel).getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width }; }, surface);
	const state = () =>
		h.evaluate(([id, sel]) => {
			const el = document.querySelector(sel);
			const e = app.plugins.plugins[id].store.entries.get(el.dataset.path);
			const bar = el.querySelector(".ink-selection-bar");
			return {
				strokes: e.doc.strokes.map((s) => ({ id: s.id, color: s.color, size: s.size, x: s.points[0], y: s.points[1] })),
				h: e.doc.h,
				lifted: el.querySelectorAll(".ink-selection-strokes path").length,
				bar: !!bar && !bar.hasClass("is-hidden"),
				frame: (() => { const f = el.querySelector(".ink-selection-frame"); return f.style.display === "none" ? null : f.getBoundingClientRect().toJSON(); })(),
			};
		}, [ID, surface]);
	const clickBar = async (sel) => {
		const p = await h.evaluate((sel) => { const b = document.querySelector(sel).getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; }, sel);
		await h.cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: p.x, y: p.y });
		await h.sleep(150);
		await h.click(p.x, p.y);
		await h.sleep(150);
	};
	const word = (x0, y0) => Array.from({ length: 16 }, (_, i) => [r.x + x0 + i * 4, r.y + y0 + 8 * Math.sin(i), 0.6]);

	// 1. Drei „Wörter“, zwei links, eins rechts
	await h.draw(word(40, 60), { pointerType: "pen" });
	await h.draw(word(40, 120), { pointerType: "pen" });
	await h.draw(word(500, 60), { pointerType: "pen" });
	await h.sleep(150);
	let s = await state();
	assert.equal(s.strokes.length, 3);
	const [a, b, c] = s.strokes;

	// 2. Lasso um die linken beiden
	await clickBar('.markdown-source-view .ink-toolbar [data-tool="lasso"]');
	const loop = Array.from({ length: 30 }, (_, i) => {
		const t = (i / 29) * Math.PI * 2;
		return [r.x + 75 + 70 * Math.cos(t), r.y + 90 + 70 * Math.sin(t), 0.5];
	});
	await h.draw(loop, { pointerType: "pen" });
	await h.sleep(200);
	s = await state();
	assert.equal(s.lifted, 2, "zwei Striche angehoben");
	assert.ok(s.bar && s.frame, "Rahmen und Leiste sichtbar");

	// 3. Verschieben: im Rahmen ziehen → neue IDs, um ~100 px nach rechts
	const f = s.frame;
	const from = [f.x + f.width / 2, f.y + f.height / 2];
	await h.draw(Array.from({ length: 11 }, (_, i) => [from[0] + i * 10, from[1], 0.5]), { pointerType: "pen" });
	await h.sleep(200);
	s = await state();
	assert.equal(s.strokes.length, 3);
	assert.ok(!s.strokes.some((x) => x.id === a.id || x.id === b.id), "alte IDs ersetzt");
	const scale = r.w / 1000;
	const moved = s.strokes.filter((x) => x.id !== c.id);
	assert.ok(Math.abs(moved[0].x - (a.x + 100 / scale)) < 3, `verschoben: ${moved[0].x} statt ${a.x + 100 / scale}`);
	assert.equal(s.lifted, 2, "bleibt ausgewählt");

	// 4. Skalieren am Griff: doppelt so groß, Strichbreite wächst mit
	const g = s.frame;
	const hx = g.x + g.width;
	const hy = g.y + g.height;
	const ox = g.x;
	const oy = g.y;
	await h.draw(Array.from({ length: 11 }, (_, i) => [hx + ((hx - ox) * i) / 10, hy + ((hy - oy) * i) / 10, 0.5]), { pointerType: "pen" });
	await h.sleep(200);
	s = await state();
	const big = s.strokes.filter((x) => x.id !== c.id);
	assert.ok(big.every((x) => x.size > a.size * 1.7), `nicht skaliert: ${big.map((x) => x.size)}`);

	// 5. Kopieren + Einfügen: zwei weitere Striche, versetzt; die Kopie ist ausgewählt
	await key("c", CTRL);
	await key("v", CTRL);
	await h.sleep(200);
	s = await state();
	assert.equal(s.strokes.length, 5);
	assert.equal(s.lifted, 2);

	// 6. Umfärben über die Leiste: rot
	await clickBar(".markdown-source-view .ink-selection-bar [data-action=color]");
	await clickBar('.markdown-source-view .ink-selection-colors [data-color="2"]');
	s = await state();
	assert.equal(s.strokes.filter((x) => x.color === 2).length, 2);

	// 7. Entf löscht die Auswahl
	await key("Delete");
	await h.sleep(150);
	s = await state();
	assert.equal(s.strokes.length, 3);
	assert.equal(s.lifted, 0);
	assert.ok(!s.bar);

	// 8. Undo: Löschen, Umfärben, Einfügen, Skalieren, Verschieben → wieder der Anfang
	for (let i = 0; i < 5; i++) {
		await key("z", CTRL);
		await h.sleep(80);
	}
	s = await state();
	assert.deepEqual(s.strokes.map((x) => x.id), [a.id, b.id, c.id]);

	// 9. Tippen mit dem Lasso ins Leere: Menü „Hier einfügen“ → in einen zweiten Block einfügen
	await h.evaluate(() => {
		app.workspace.activeEditor.editor.setCursor({ line: 0, ch: 0 });
		app.commands.executeCommandById("obsidian-ink-blocks:insert-notebook");
	});
	await h.sleep(900);
	const second = await h.evaluate(() => {
		const els = [...document.querySelectorAll(".markdown-source-view .ink-surface")];
		const el = els.find((e) => e.dataset.strokes === "0");
		el.scrollIntoView({ block: "center" });
		return el.dataset.path;
	});
	await h.sleep(300);
	const r2 = await h.evaluate((p) => { const b = document.querySelector(`.ink-surface[data-path="${p}"]`).getBoundingClientRect(); return { x: b.x, y: b.y }; }, second);
	await h.click(r2.x + 200, r2.y + 100);
	await h.sleep(300);
	const items = await h.evaluate(() => [...document.querySelectorAll(".menu .menu-item-title")].map((e) => e.textContent));
	assert.deepEqual(items, ["Hier einfügen"]);
	await clickBar(".menu .menu-item");
	await h.sleep(200);
	const pasted = await h.evaluate(([id, p]) => app.plugins.plugins[id].store.entries.get(p).doc.strokes.length, [ID, second]);
	assert.equal(pasted, 2, "in den zweiten Block eingefügt (Zwischenablage stammt aus Schritt 5)");
	await h.screenshot("m16-lasso.png");
};
