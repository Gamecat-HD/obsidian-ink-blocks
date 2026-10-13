// M2: Zeichnen mit Stift (Druck) und Maus, Textmarker, Radierer (Werkzeug + Radierer-Ende), Speichern,
// Resize, Neustart; Live Preview darf dabei nicht in den Quelltext springen.
import assert from "node:assert/strict";
const ID = "obsidian-ink-blocks";

export default async (h) => {
	await h.evaluate(async () => {
		await app.workspace.getLeaf().openFile(app.vault.getFileByPath("Notiz.md"), { state: { mode: "source", source: false } });
		app.workspace.activeEditor.editor.setCursor({ line: 3, ch: 0 });
		app.commands.executeCommandById("obsidian-ink-blocks:insert-notebook");
	});
	await h.sleep(800);

	const info = () =>
		h.evaluate((id) => {
			const el = document.querySelector(".markdown-source-view .ink-surface");
			const r = el.getBoundingClientRect();
			const path = el.dataset.path;
			const entry = app.plugins.plugins[id].store.entries.get(path);
			return {
				path,
				rect: { x: r.x, y: r.y, w: r.width, h: r.height },
				strokes: entry.doc.strokes.map((s) => ({
					id: s.id, tool: s.tool, color: s.color, simulated: !!s.simulated, n: s.points.length / 3,
					pressures: [...new Set(s.points.filter((_, i) => i % 3 === 2).map((p) => p.toFixed(2)))].length,
				})),
				cursor: app.workspace.activeEditor.editor.getCursor(),
			};
		}, ID);
	// Deckt ein Pixel um (vx, vy) (Viewport) auf den Kacheln Tinte?
	const inked = (vx, vy) =>
		h.evaluate((vx, vy) => {
			for (const c of document.querySelectorAll(".markdown-source-view .ink-tile")) {
				const r = c.getBoundingClientRect();
				if (vy < r.top || vy > r.bottom || !c.width) continue;
				const sx = c.width / r.width;
				const d = c.getContext("2d").getImageData(Math.round((vx - r.left) * sx) - 3, Math.round((vy - r.top) * sx) - 3, 7, 7).data;
				for (let i = 3; i < d.length; i += 4) if (d[i] > 0) return true;
			}
			return false;
		}, vx, vy);
	const setTool = (tool) => h.evaluate((id, tool) => { app.plugins.plugins[id].settings.tools.tool = tool; }, ID, tool);

	let s = await info();
	const { x, y, w } = s.rect;
	const cursorBefore = s.cursor;
	const line = (y0, x0 = 0.1, x1 = 0.6, n = 30, p = (t) => 0.2 + 0.7 * t) =>
		Array.from({ length: n }, (_, i) => [x + w * (x0 + ((x1 - x0) * i) / (n - 1)), y + y0 + 6 * Math.sin(i / 3), p(i / (n - 1))]);

	// 1. Stift mit Druck
	await h.draw(line(60), { pointerType: "pen" });
	await h.sleep(150);
	s = await info();
	assert.equal(s.strokes.length, 1, "Stiftstrich fehlt");
	assert.equal(s.strokes[0].simulated, false);
	assert.ok(s.strokes[0].pressures > 5, `Druckwerte: ${s.strokes[0].pressures}`);
	assert.ok(s.strokes[0].n > 10);
	assert.ok(await inked(x + w * 0.35, y + 60 + 6 * Math.sin(15 / 3) - 0), "Stiftstrich nicht gezeichnet");
	assert.deepEqual(s.cursor, cursorBefore, "Zeichnen hat den Editor-Cursor bewegt");
	assert.ok(await h.evaluate(() => !!document.querySelector(".markdown-source-view .ink-surface")), "Block nicht mehr gerendert");

	// 1b. Während des Strichs: schon auf den Kacheln sichtbar (ohne eigenen Live-Canvas), noch nicht im Dokument
	const mv = (type, [px, py], buttons = 1) =>
		h.cdp.send("Input.dispatchMouseEvent", { type, x: px, y: py, button: "left", buttons, clickCount: 1, pointerType: "pen", force: 0.6 });
	const mid = line(240, 0.6, 0.9, 12);
	await mv("mouseMoved", mid[0], 0);
	await mv("mousePressed", mid[0]);
	for (const p of mid.slice(1)) await mv("mouseMoved", p);
	await h.sleep(100);
	assert.ok(await inked(mid[6][0], mid[6][1]), "Live-Strich während des Zeichnens nicht sichtbar");
	assert.equal(await h.evaluate(() => document.querySelectorAll(".ink-live").length), 0, "Live-Canvas sollte es nicht mehr geben");
	assert.equal((await info()).strokes.length, 1, "Strich vor dem Absetzen schon im Dokument");
	await mv("mouseReleased", mid.at(-1), 0);
	await h.sleep(100);
	assert.equal((await info()).strokes.length, 2);
	assert.ok(await inked(mid[6][0], mid[6][1]), "Strich nach dem Absetzen weg");

	// 1c. Abbruch (pointercancel) entfernt den Live-Strich wieder
	await h.evaluate((pts) => {
		const el = document.querySelector(".markdown-source-view .ink-surface");
		const fire = (type, [cx, cy]) =>
			el.dispatchEvent(new PointerEvent(type, { pointerId: 78, pointerType: "pen", buttons: 1, clientX: cx, clientY: cy, pressure: 0.6, bubbles: true, cancelable: true }));
		fire("pointerdown", pts[0]);
		for (const p of pts.slice(1)) fire("pointermove", p);
	}, line(300, 0.6, 0.9, 12));
	const cancelAt = line(300, 0.6, 0.9, 12)[6];
	assert.ok(await inked(cancelAt[0], cancelAt[1]), "Live-Strich (synthetisch) nicht sichtbar");
	await h.evaluate(([cx, cy]) => {
		const el = document.querySelector(".markdown-source-view .ink-surface");
		el.dispatchEvent(new PointerEvent("pointercancel", { pointerId: 78, pointerType: "pen", clientX: cx, clientY: cy, bubbles: true }));
	}, cancelAt);
	assert.equal(await inked(cancelAt[0], cancelAt[1]), false, "Abgebrochener Live-Strich noch sichtbar");
	assert.equal((await info()).strokes.length, 2, "Abgebrochener Strich im Dokument");
	// Für die folgenden Schritte wieder entfernen
	await h.evaluate((id) => { const st = app.plugins.plugins[id].store; const e = [...st.entries.values()][0]; e.doc.strokes.pop(); }, ID);

	// 2. Maus → simulierter Druck
	await h.draw(line(120, 0.1, 0.5, 20, () => 0.5), { pointerType: "mouse" });
	// 3. Textmarker (konstanter Druck 0.5 → wie Maus als „simuliert“ markiert)
	await setTool("hl");
	await h.draw(line(200, 0.2, 0.4, 15, () => 0.5), { pointerType: "pen" });
	await h.sleep(150);
	s = await info();
	assert.deepEqual(s.strokes.map((st) => [st.tool, st.simulated]), [["pen", false], ["pen", true], ["hl", true]]);
	assert.equal(s.strokes[2].color, 3);
	await h.screenshot("m2-drawn.png");

	// 4. Radierer-Werkzeug quer über die Maus-Linie
	await setTool("eraser");
	await h.draw([[x + w * 0.3, y + 100, 0.5], [x + w * 0.3, y + 140, 0.5]], { pointerType: "mouse" });
	await setTool("pen");
	await h.sleep(150);
	s = await info();
	assert.deepEqual(s.strokes.map((st) => st.tool), ["pen", "hl"], "Radieren per Werkzeug");
	assert.equal(await inked(x + w * 0.3, y + 120), false, "Radierter Strich noch sichtbar");

	// 5. Radierer-Ende des Stifts (buttons = 32) über den Textmarker.
	//    CDP leitet `buttons` aus `button` ab, daher synthetische PointerEvents.
	await h.evaluate((pts) => {
		const el = document.querySelector(".markdown-source-view .ink-surface");
		const fire = (type, [cx, cy]) =>
			el.dispatchEvent(new PointerEvent(type, { pointerId: 77, pointerType: "pen", buttons: type === "pointerup" ? 0 : 32, button: 5, clientX: cx, clientY: cy, pressure: 0.5, bubbles: true, cancelable: true }));
		fire("pointerdown", pts[0]);
		for (const p of pts.slice(1)) fire("pointermove", p);
		fire("pointerup", pts.at(-1));
	}, [[x + w * 0.3, y + 180], [x + w * 0.3, y + 200], [x + w * 0.3, y + 220]]);
	await h.sleep(150);
	s = await info();
	assert.deepEqual(s.strokes.map((st) => st.tool), ["pen"], "Radierer-Ende (buttons=32) hat den Textmarker nicht entfernt");

	// 6. Gebündelt gespeichert
	await h.sleep(2000);
	const file = JSON.parse(await h.evaluate((p) => app.vault.adapter.read(p), s.path));
	assert.equal(file.strokes.length, s.strokes.length, "Datei ≠ Speicher");

	// 7. Resize: schmaler → Striche skalieren mit
	await h.cdp.send("Emulation.setDeviceMetricsOverride", { width: 1000, height: 900, deviceScaleFactor: 1, mobile: false });
	await h.sleep(600);
	const narrow = await info();
	assert.ok(narrow.rect.w < w, `Breite ${narrow.rect.w} !< ${w}`);
	const k = narrow.rect.w / w;
	if (narrow.strokes.some((st) => st.tool === "pen")) {
		assert.ok(await inked(narrow.rect.x + (w * 0.55) * k, narrow.rect.y + (60 + 6 * Math.sin(27 / 3)) * k), "nach Resize nicht gezeichnet");
	}

	// 8. Neustart des Plugins → Striche aus Datei
	await h.evaluate(async (id) => { await app.plugins.disablePlugin(id); await app.plugins.enablePlugin(id); }, ID);
	await h.sleep(800);
	const after = await info();
	assert.equal(after.strokes.length, s.strokes.length, "nach Neustart");
	await h.screenshot("m2-final.png");
};
