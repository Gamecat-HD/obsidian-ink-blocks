// M13: Formerkennung – Freihand-Form zeichnen, Stift halten → saubere Form (live sichtbar, gespeichert mit
// shape-Flag); ohne Halten bleibt der Strich Freihand; abschaltbar; Formen gehen nicht in die Texterkennung.
import assert from "node:assert/strict";
const ID = "obsidian-ink-blocks";

export default async (h) => {
	await h.evaluate(async () => {
		await app.workspace.getLeaf().openFile(app.vault.getFileByPath("Notiz.md"), { state: { mode: "source", source: false } });
		app.workspace.activeEditor.editor.setCursor({ line: 3, ch: 0 });
		app.commands.executeCommandById("obsidian-ink-blocks:insert-notebook");
	});
	await h.sleep(800);
	const r = await h.evaluate(() => { const b = document.querySelector(".markdown-source-view .ink-surface").getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width }; });
	const last = () =>
		h.evaluate((id) => {
			const el = document.querySelector(".markdown-source-view .ink-surface");
			const doc = app.plugins.plugins[id].store.entries.get(el.dataset.path).doc;
			const s = doc.strokes.at(-1);
			const xs = s.points.filter((_, i) => i % 3 === 0);
			const ys = s.points.filter((_, i) => i % 3 === 1);
			return {
				count: doc.strokes.length,
				shape: !!s.shape,
				uniqueY: new Set(ys.map((v) => v.toFixed(2))).size,
				w: Math.max(...xs) - Math.min(...xs),
				h: Math.max(...ys) - Math.min(...ys),
			};
		}, ID);
	const ev = (type, [x, y], buttons = 1) =>
		h.cdp.send("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons, clickCount: 1, pointerType: "pen", force: 0.6 });
	/** Freihand-Zug durch die Ecken (Viewport), optional am Ende halten. */
	const stroke = async (corners, { hold = 0, closed = false } = {}) => {
		const pts = closed ? [...corners, corners[0]] : corners;
		const path = [];
		let k = 0;
		for (let i = 0; i < pts.length - 1; i++) {
			const [ax, ay] = pts[i];
			const [bx, by] = pts[i + 1];
			const n = Math.max(2, Math.round(Math.hypot(bx - ax, by - ay) / 6));
			for (let j = 0; j < n; j++, k++) path.push([ax + ((bx - ax) * j) / n + 1.5 * Math.sin(k), ay + ((by - ay) * j) / n + 1.5 * Math.cos(k * 1.3)]);
		}
		path.push(pts.at(-1));
		await ev("mouseMoved", path[0], 0);
		await ev("mousePressed", path[0]);
		for (const p of path.slice(1)) await ev("mouseMoved", p);
		if (hold) await h.sleep(hold);
		await ev("mouseReleased", path.at(-1), 0);
		await h.sleep(150);
	};
	const X = (f) => r.x + r.w * f;
	const Y = (dy) => r.y + dy;

	// 1. Rechteck halten → achsparalleles Rechteck, live schon vor dem Absetzen
	await stroke([[X(0.3), Y(60)], [X(0.5), Y(60)], [X(0.5), Y(160)], [X(0.1), Y(160)], [X(0.1), Y(60)], [X(0.28), Y(60)]], { hold: 700 });
	let s = await last();
	assert.ok(s.shape, "Rechteck nicht erkannt");
	assert.ok(s.uniqueY < 300, `Rechteck nicht sauber (${s.uniqueY} verschiedene y)`);
	await h.screenshot("m13-rect.png");

	// 2. Fast gerade Linie halten → exakt waagerecht
	await stroke([[X(0.6), Y(80)], [X(0.9), Y(86)]], { hold: 700 });
	s = await last();
	assert.deepEqual([s.shape, s.uniqueY], [true, 1], JSON.stringify(s));

	// 3. Kreis halten
	const circle = Array.from({ length: 36 }, (_, i) => [X(0.75) + 60 * Math.cos((i / 36) * 2 * Math.PI * 0.98), Y(220) + 58 * Math.sin((i / 36) * 2 * Math.PI * 0.98)]);
	await stroke(circle, { hold: 700 });
	s = await last();
	assert.ok(s.shape && Math.abs(s.w - s.h) < 3, `Kreis: ${JSON.stringify(s)}`);

	// 4. Ohne Halten bleibt es Freihand
	await stroke([[X(0.1), Y(260)], [X(0.3), Y(266)]]);
	s = await last();
	assert.equal(s.shape, false, "Ohne Halten zur Form geworden");

	// 5. Abgeschaltet → kein Einrasten
	await h.evaluate((id) => { app.plugins.plugins[id].settings.shapeRecognition = false; }, ID);
	await stroke([[X(0.1), Y(320)], [X(0.4), Y(326)]], { hold: 700 });
	s = await last();
	assert.equal(s.shape, false, "Formerkennung trotz Abschalten");
	assert.equal(s.count, 5);

	// 6. Gespeichert mit sh:1
	await h.sleep(1500);
	const text = await h.evaluate((id) => {
		const el = document.querySelector(".markdown-source-view .ink-surface");
		return app.vault.adapter.read(el.dataset.path);
	}, ID);
	assert.equal((text.match(/"sh":1/g) ?? []).length, 3, text.slice(0, 400));
	await h.screenshot("m13-shapes.png");
};
