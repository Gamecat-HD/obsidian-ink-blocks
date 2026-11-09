// M30: Neuzeichnen nur der geänderten Bereiche (Live-Strich, Strich-Ende, Radieren, Undo, fremde Änderung)
// muss dasselbe Bild ergeben wie das vollständige Neuzeichnen aller Kacheln. Bis auf Kantenpixel: Skia rastert
// Antialiasing-Kanten innerhalb eines Clips minimal anders (gemessen: auch ohne Dokumentänderung, nur durch
// Neumalen kleiner Ausschnitte ~0,6 % der Tintenpixel, vormultipliziert max. ~70/255). Das galt schon für den
// bisherigen Live-Strich.
import assert from "node:assert/strict";
const ID = "obsidian-ink-blocks";
export const options = { width: 1280, height: 1400, dpr: 1.5 };

export default async (h) => {
	await h.evaluate(async () => {
		await app.workspace.getLeaf().openFile(app.vault.getFileByPath("Notiz.md"), { state: { mode: "source", source: false } });
		app.workspace.activeEditor.editor.setCursor({ line: 3, ch: 0 });
		app.commands.executeCommandById("obsidian-ink-blocks:insert-notebook");
	});
	await h.sleep(1000);

	const result = await h.evaluate(async (id) => {
		const plugin = app.plugins.plugins[id];
		plugin.settings.shapeRecognition = false;
		const tools = plugin.settings.tools;
		const editor = [...plugin.editors][0];
		const { surface, entry } = editor;
		const el = surface.el;
		const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
		const settle = async () => {
			for (let i = 0; i < 4; i++) await frame();
		};
		let seed = 3;
		const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
		const hand = (x0, y0, n, sid, extra = {}) => {
			const p = [];
			for (let i = 0; i < n; i++) {
				const t = i / 5;
				p.push(x0 + i * 1.1 + 5 * Math.cos(t), y0 + 8 * Math.sin(t), 0.2 + 0.7 * Math.abs(Math.sin(t / 2)));
			}
			return { id: sid, tool: "pen", color: 0, size: 3, points: p, ...extra };
		};
		const strokes = [];
		for (let i = 0; i < 800; i++) {
			const r = rnd();
			const extra = r < 0.15 ? { tool: "hl", color: 3 + (i % 6), size: 14 } : r < 0.3 ? { color: 1 + (i % 2) } : r < 0.35 ? { color: "#40c057", simulated: true } : {};
			strokes.push(hand(20 + rnd() * 880, 40 + rnd() * 1100, 15 + Math.floor(rnd() * 50), `b${i}`, extra));
		}
		entry.doc.strokes = strokes;
		entry.doc.h = 1200;
		editor.setDoc();
		await settle();

		/** Alle sichtbaren Kacheln auslesen. */
		const snap = () =>
			[...el.querySelectorAll("canvas.ink-tile")].filter((c) => c.width).map((c) => c.getContext("2d").getImageData(0, 0, c.width, c.height).data);
		/**
		 * Inkrementellen Stand mit vollständigem Neuzeichnen vergleichen. Skia rastert Kanten mit Clip minimal
		 * anders (auch ohne jede Änderung am Dokument, siehe README des Tests) – daher zusätzlich über 4×4-Blöcke
		 * gemittelt: Kantenrauschen mittelt sich weg, ein fehlender/überzähliger Strich nicht.
		 */
		const compare = () => {
			const a = snap();
			const widths = [...el.querySelectorAll("canvas.ink-tile")].filter((c) => c.width).map((c) => c.width);
			surface.redrawAll();
			const b = snap();
			let diff = 0;
			let maxDelta = 0;
			let inked = 0;
			let maxBlock = 0;
			for (let t = 0; t < Math.max(a.length, b.length); t++) {
				const x = a[t];
				const y = b[t];
				if (!x || !y || x.length !== y.length) return { diff: -1, maxDelta: -1, maxBlock: -1, inked };
				const w = widths[t];
				const hgt = x.length / 4 / w;
				const blocks = new Float64Array(Math.ceil(w / 4) * Math.ceil(hgt / 4));
				const bw = Math.ceil(w / 4);
				for (let i = 0; i < x.length; i += 4) {
					if (y[i + 3]) inked++;
					// Vormultipliziert vergleichen: Farbwerte fast durchsichtiger Kantenpixel sind beliebig.
					let d = x[i + 3] - y[i + 3];
					let m = Math.abs(d);
					for (let c = 0; c < 3; c++) m = Math.max(m, Math.abs(x[i + c] * x[i + 3] - y[i + c] * y[i + 3]) / 255);
					if (m >= 1) {
						diff++;
						if (m > maxDelta) maxDelta = m;
					}
					const p = i / 4;
					blocks[Math.floor(Math.floor(p / w) / 4) * bw + Math.floor((p % w) / 4)] += d / 16;
				}
				for (const v of blocks) maxBlock = Math.max(maxBlock, Math.abs(v));
			}
			return { diff, maxDelta: Math.round(maxDelta), maxBlock: +maxBlock.toFixed(1), inked, tiles: a.length };
		};
		const ev = (type, x, y, pressure = 0.6, buttons = 1) => {
			const r = el.getBoundingClientRect();
			const s = surface.docScale;
			return new PointerEvent(type, {
				pointerId: 5, pointerType: "pen", isPrimary: true, bubbles: true, cancelable: true,
				clientX: r.left + el.clientLeft + x * s, clientY: r.top + el.clientTop + y * s,
				pressure, buttons: type === "pointerup" ? 0 : buttons, button: type === "pointermove" ? -1 : 0,
			});
		};
		const path = (x0, y0, n) => Array.from({ length: n }, (_, i) => [x0 + i * 1.3 + 7 * Math.cos(i / 4), y0 + 10 * Math.sin(i / 4) + (i % 50) * 0.3, 0.2 + 0.6 * Math.abs(Math.sin(i / 9))]);
		const out = {};
		// Chromium schaltet eine Canvas nach dem ersten Zurücklesen auf Software-Rasterung um (Kanten fallen
		// danach minimal anders aus) – vorher einmal umschalten lassen.
		for (let i = 0; i < 2; i++) {
			snap();
			surface.redrawAll();
		}
		out.stable = compare();

		// 1. Live-Strich über dichten Strichen: mitten im Strich vergleichen (Live-Pfad gehört dazu)
		tools.tool = "pen";
		let pts = path(100, 300, 400);
		el.dispatchEvent(ev("pointerdown", ...pts[0]));
		for (const p of pts.slice(1, 250)) el.dispatchEvent(ev("pointermove", ...p));
		out.liveMid = compare();
		for (const p of pts.slice(250)) el.dispatchEvent(ev("pointermove", ...p));
		out.liveEnd = compare();
		el.dispatchEvent(ev("pointerup", ...pts.at(-1)));
		out.afterFinish = compare();

		// 2. Textmarker (liegt unter der Schrift) live und fertig
		tools.tool = "hl";
		plugin.settings.hlStraight = false;
		pts = path(300, 600, 200);
		el.dispatchEvent(ev("pointerdown", ...pts[0]));
		for (const p of pts.slice(1)) el.dispatchEvent(ev("pointermove", ...p));
		out.hlLive = compare();
		el.dispatchEvent(ev("pointerup", ...pts.at(-1)));
		out.hlFinish = compare();

		// 3. Radieren (ganze Striche) und präzise
		tools.tool = "eraser";
		plugin.settings.eraserMode = "stroke";
		el.dispatchEvent(ev("pointerdown", 50, 100));
		for (let i = 1; i <= 80; i++) el.dispatchEvent(ev("pointermove", 50 + i * 8, 100 + i * 5));
		el.dispatchEvent(ev("pointerup", 690, 500));
		out.erase = compare();
		plugin.settings.eraserMode = "precise";
		el.dispatchEvent(ev("pointerdown", 900, 150));
		for (let i = 1; i <= 80; i++) el.dispatchEvent(ev("pointermove", 900 - i * 9, 150 + i * 6));
		el.dispatchEvent(ev("pointerup", 180, 630));
		out.precise = compare();
		tools.tool = "pen";

		// 4. Rückgängig/Wiederholen
		editor.undo();
		out.undo = compare();
		editor.redo();
		out.redo = compare();

		// 5. Fremde Änderung (wie nach dem Zusammenführen): manche Striche weg, neue dazu, Rest gleiche Objekte
		const next = entry.doc.strokes.filter((_, i) => i % 17 !== 0);
		for (let i = 0; i < 12; i++) next.splice(Math.floor(rnd() * next.length), 0, hand(50 + rnd() * 800, 60 + rnd() * 1000, 40, `r${i}`, { color: 2 }));
		entry.doc = { ...entry.doc, strokes: next };
		editor.setDoc();
		out.remote = compare();

		// 6. Fremde Änderung während eines eigenen Strichs: Live-Strich bleibt sichtbar
		pts = path(150, 900, 150);
		el.dispatchEvent(ev("pointerdown", ...pts[0]));
		for (const p of pts.slice(1, 80)) el.dispatchEvent(ev("pointermove", ...p));
		entry.doc = { ...entry.doc, strokes: [...entry.doc.strokes, hand(600, 950, 50, "r-live", { color: 1 })] };
		editor.setDoc();
		out.remoteDuringLive = compare();
		out.liveKept = !!surface.live;
		for (const p of pts.slice(80)) el.dispatchEvent(ev("pointermove", ...p));
		el.dispatchEvent(ev("pointerup", ...pts.at(-1)));
		out.afterLiveFinish = compare();
		out.strokes = entry.doc.strokes.length;
		return out;
	}, ID);

	console.log(JSON.stringify(result));
	for (const [step, r] of Object.entries(result)) {
		if (typeof r !== "object") continue;
		assert.ok(r.tiles > 0 && r.inked > 1000, `${step}: nichts gezeichnet ${JSON.stringify(r)}`);
		// Kantenrauschen: wenige Pixel, gemittelt kaum messbar. Ein fehlender Strich ergäbe Blöcke mit Δ ≫ 30.
		assert.ok(r.maxBlock <= 12, `${step}: Block-Abweichung ${r.maxBlock} (${r.diff} Pixel, max. ${r.maxDelta})`);
		assert.ok(r.diff <= r.inked * 0.01, `${step}: ${r.diff} Pixel weichen ab`);
	}
	assert.equal(result.liveKept, true, "Live-Strich nach fremder Änderung verloren");
};
