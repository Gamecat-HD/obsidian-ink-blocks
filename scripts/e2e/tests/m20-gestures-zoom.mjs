// M20: Zwei-Finger-Tipp = Rückgängig, Drei-Finger-Tipp = Wiederholen (auch wenn Finger sonst scrollen);
// ausgeklappte Ansicht: Leiste fest im Kopf, Zoom per Knopf, Strg+Mausrad und Pinch, Zeichnen bleibt deckungsgleich.
import assert from "node:assert/strict";
const ID = "obsidian-ink-blocks";
const CTRL = 2;

export default async (h) => {
	await h.evaluate(async () => {
		await app.workspace.getLeaf().openFile(app.vault.getFileByPath("Notiz.md"), { state: { mode: "source", source: false } });
		app.workspace.activeEditor.editor.setCursor({ line: 3, ch: 0 });
		app.commands.executeCommandById("obsidian-ink-blocks:insert-notebook");
	});
	await h.sleep(800);
	for (const icon of ["zoom-in", "zoom-out"]) {
		const icons = await h.evaluate((id) => app.plugins.plugins[id].dev.getIconIds(), ID);
		assert.ok(icons.includes(icon) || icons.includes(`lucide-${icon}`), `Icon fehlt: ${icon}`);
	}
	const surface = ".markdown-source-view .ink-surface";
	const r = await h.evaluate((sel) => { const b = document.querySelector(sel).getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width }; }, surface);
	const count = () => h.evaluate(([id, sel]) => app.plugins.plugins[id].store.entries.get(document.querySelector(sel).dataset.path).doc.strokes.length, [ID, surface]);
	const touch = async (type, points) => {
		await h.cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points.map(([x, y], id) => ({ x, y, id, radiusX: 5, radiusY: 5, force: 1 })) });
	};
	const fingerTap = async (n, x, y) => {
		const pts = Array.from({ length: n }, (_, i) => [x + i * 60, y]);
		await touch("touchStart", pts);
		await h.sleep(60);
		await touch("touchEnd", []);
		await h.sleep(250);
	};

	// 1. Zwei Striche, Zwei-Finger-Tipp nimmt einen zurück, Drei-Finger-Tipp holt ihn wieder
	for (const y of [60, 120]) await h.draw(Array.from({ length: 12 }, (_, i) => [r.x + 100 + i * 10, r.y + y, 0.6]), { pointerType: "pen" });
	await h.sleep(600); // Handballen-Schonfrist nach dem Stift
	assert.equal(await count(), 2);
	await fingerTap(2, r.x + 300, r.y + 200);
	assert.equal(await count(), 1, "Zwei-Finger-Tipp = Rückgängig");
	await fingerTap(3, r.x + 300, r.y + 200);
	assert.equal(await count(), 2, "Drei-Finger-Tipp = Wiederholen");
	// Ein Finger allein ändert nichts (scrollt höchstens)
	await fingerTap(1, r.x + 300, r.y + 200);
	assert.equal(await count(), 2);

	// 2. Ausklappen: Leiste sitzt im Kopf, Zoom 100 %
	const center = (sel) => h.evaluate((sel) => { const b = document.querySelector(sel).getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; }, sel);
	const tb = await center(".markdown-source-view .ink-tb-expand");
	await h.cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: tb.x, y: tb.y });
	await h.sleep(150);
	await h.click(tb.x, tb.y);
	await h.sleep(800);
	const zoomState = () =>
		h.evaluate(() => {
			const m = document.querySelector(".ink-expanded-modal");
			const c = m.querySelector(".ink-block.ink-expanded");
			const s = m.querySelector(".ink-expanded-scroll");
			return {
				label: m.querySelector(".ink-zoom-label").textContent,
				width: c.getBoundingClientRect().width,
				view: s.clientWidth,
				toolbarInHeader: !!m.querySelector(".ink-expanded-header .ink-toolbar"),
				toolbarVisible: getComputedStyle(m.querySelector(".ink-toolbar")).opacity === "1",
			};
		});
	let z = await zoomState();
	assert.equal(z.label, "100 %");
	assert.ok(z.toolbarInHeader && z.toolbarVisible, "Leiste im Kopf");
	const base = z.width;

	// 3. Knopf „+“ → 125 %, Fläche 1,25× so breit
	const zin = await center(".ink-expanded-modal .ink-zoom button[aria-label^='Vergrößern']");
	await h.click(zin.x, zin.y);
	await h.sleep(300);
	z = await zoomState();
	assert.equal(z.label, "125 %");
	assert.ok(Math.abs(z.width - base * 1.25) < 2, `Breite ${z.width} statt ${base * 1.25}`);

	// 4. Strg+Mausrad hinein
	const sc = await center(".ink-expanded-modal .ink-expanded-scroll");
	await h.cdp.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: sc.x, y: sc.y, deltaX: 0, deltaY: -200, modifiers: CTRL });
	await h.sleep(300);
	z = await zoomState();
	assert.ok(parseInt(z.label) > 125, `Strg+Rad: ${z.label}`);

	// 5. Pinch auseinander → weiter hinein (gedeckelt bei 300 %)
	const before = parseInt(z.label);
	await touch("touchStart", [[sc.x - 50, sc.y], [sc.x + 50, sc.y]]);
	for (let i = 1; i <= 8; i++) {
		await touch("touchMove", [[sc.x - 50 - i * 10, sc.y], [sc.x + 50 + i * 10, sc.y]]);
		await h.sleep(30);
	}
	await touch("touchEnd", []);
	await h.sleep(300);
	z = await zoomState();
	assert.ok(parseInt(z.label) > before, `Pinch: ${z.label} nach ${before}`);
	assert.ok(parseInt(z.label) <= 300);

	// 6. Gezoomt zeichnen: Strich landet an der Stelle unter dem Stift (Doc-Koordinaten stimmen)
	const n = await count();
	const pt = await h.evaluate(() => {
		const s = document.querySelector(".ink-expanded-modal .ink-expanded-scroll").getBoundingClientRect();
		return { x: s.x + s.width / 2, y: s.y + s.height / 2 };
	});
	await h.draw(Array.from({ length: 10 }, (_, i) => [pt.x + i * 6, pt.y, 0.6]), { pointerType: "pen" });
	await h.sleep(200);
	const check = await h.evaluate(([id, x, y]) => {
		const el = document.querySelector(".ink-expanded-modal .ink-surface");
		const b = el.getBoundingClientRect();
		const scale = b.width / 1000;
		const doc = app.plugins.plugins[id].store.entries.get(el.dataset.path).doc;
		const s = doc.strokes.at(-1);
		return { n: doc.strokes.length, dx: Math.abs(s.points[0] - (x - b.x - el.clientLeft) / scale), dy: Math.abs(s.points[1] - (y - b.y - el.clientTop) / scale) };
	}, [ID, pt.x, pt.y]);
	assert.equal(check.n, n + 1);
	assert.ok(check.dx < 1 && check.dy < 1, `Versatz ${check.dx}/${check.dy}`);
	await h.screenshot("m20-zoom.png");

	// 7. Klick auf „125 %“-Label setzt zurück
	const lbl = await center(".ink-expanded-modal .ink-zoom-label");
	await h.click(lbl.x, lbl.y);
	await h.sleep(300);
	z = await zoomState();
	assert.equal(z.label, "100 %");
	assert.ok(Math.abs(z.width - base) < 2);
};
