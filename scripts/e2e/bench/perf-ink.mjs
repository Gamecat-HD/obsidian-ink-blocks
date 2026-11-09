// Leistungsmessung (kein Abnahmetest): Kosten pro Stiftbewegung bei langen Strichen, Neuzeichnen vieler Striche,
// Abschluss eines Strichs, Neu-Laden (fremde Änderung) und fremde Live-Striche – in einer echten, headless
// Obsidian-Instanz. Zeiten in ms (Median), inkl. Rasterung (1-px-getImageData erzwingt das Zeichnen).
// Aufruf: npm run build && node scripts/e2e/run.mjs scripts/e2e/bench/perf-ink.mjs
// Ergebnis: Konsole + e2e-out/perf-ink.json (PERF_OUT=… für anderen Namen)
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const ID = "obsidian-ink-blocks";
// PLUGIN_FROM=<Ordner mit main.js/manifest.json/styles.css> misst einen anderen Stand (z. B. vor der Optimierung).
export const options = { width: 1280, height: 1600, pluginFrom: process.env.PLUGIN_FROM };

export default async (h) => {
	await h.evaluate(async () => {
		await app.workspace.getLeaf().openFile(app.vault.getFileByPath("Notiz.md"), { state: { mode: "source", source: false } });
		app.workspace.activeEditor.editor.setCursor({ line: 3, ch: 0 });
		app.commands.executeCommandById("obsidian-ink-blocks:insert-notebook");
	});
	await h.sleep(1000);

	const results = await h.evaluate(async (id) => {
		const plugin = app.plugins.plugins[id];
		plugin.settings.shapeRecognition = false;
		plugin.settings.tools.tool = "pen";
		const editor = [...plugin.editors][0];
		const { surface, entry } = editor;
		const el = surface.el;
		const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
		const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
		const median = (a) => {
			const s = [...a].sort((x, y) => x - y);
			return s.length ? +s[Math.floor(s.length / 2)].toFixed(3) : null;
		};
		// Rasterung erzwingen: alle sichtbaren Kacheln 1 px zurücklesen.
		const flush = () => {
			for (const c of el.querySelectorAll("canvas.ink-tile")) if (c.width) c.getContext("2d").getImageData(0, 0, 1, 1);
		};
		// Feste Zufallsfolge (gleiche Striche vor/nach der Optimierung)
		let seed = 42;
		const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);

		// Handschrift-ähnlicher Strich: Schleifen entlang einer Zeile
		const handStroke = (x0, y0, n, id) => {
			const p = [];
			for (let i = 0; i < n; i++) {
				const t = i / 6;
				p.push(x0 + i * 0.9 + 6 * Math.cos(t), y0 + 9 * Math.sin(t) + 2 * Math.sin(t / 7), 0.3 + 0.5 * Math.abs(Math.sin(t / 3)));
			}
			return { id, tool: rnd() < 0.1 ? "hl" : "pen", color: rnd() < 0.1 ? 3 : 0, size: 3, points: p };
		};
		const fill = (count, height) => {
			const strokes = [];
			for (let i = 0; i < count; i++) {
				const x = 20 + rnd() * 900;
				const y = 30 + rnd() * (height - 60);
				strokes.push(handStroke(x, y, 30 + Math.floor(rnd() * 40), `b${i}`));
			}
			return strokes;
		};
		const setStrokes = (strokes, height) => {
			entry.doc.strokes = strokes;
			entry.doc.h = height;
			editor.setDoc();
		};
		const settle = async () => {
			for (let i = 0; i < 4; i++) await frame();
			await sleep(50);
		};

		const ev = (type, x, y, pressure = 0.6) => {
			const r = el.getBoundingClientRect();
			const s = surface.docScale;
			return new PointerEvent(type, {
				pointerId: 7, pointerType: "pen", isPrimary: true, bubbles: true, cancelable: true,
				clientX: r.left + el.clientLeft + x * s, clientY: r.top + el.clientTop + y * s,
				pressure, buttons: type === "pointerup" ? 0 : 1, button: type === "pointermove" ? -1 : 0,
			});
		};

		/** Langen Strich zeichnen; misst jede Bewegung (Handler + Rasterung). */
		const liveStroke = async (n, y0) => {
			const times = [];
			const pts = [];
			for (let i = 0; i < n; i++) {
				const t = i / 6;
				pts.push([60 + (i * 0.85) % 860 + 6 * Math.cos(t), y0 + 9 * Math.sin(t) + Math.floor((i * 0.85) / 860) * 40, 0.3 + 0.5 * Math.abs(Math.sin(t / 3))]);
			}
			el.dispatchEvent(ev("pointerdown", ...pts[0]));
			flush();
			for (let i = 1; i < n; i++) {
				const e = ev("pointermove", ...pts[i]);
				const t0 = performance.now();
				el.dispatchEvent(e);
				flush();
				times.push(performance.now() - t0);
			}
			const e = ev("pointerup", ...pts[n - 1]);
			const t0 = performance.now();
			el.dispatchEvent(e);
			flush();
			const up = performance.now() - t0;
			await settle();
			return {
				// Bewegungen am Ende des Strichs (Länge ≈ n)
				moveAtEnd: median(times.slice(-50)),
				moveFirst50: median(times.slice(0, 50)),
				moveMax: +Math.max(...times).toFixed(3),
				totalMoves: +times.reduce((a, b) => a + b, 0).toFixed(1),
				finish: +up.toFixed(3),
			};
		};

		const out = { scale: surface.docScale, dpr: devicePixelRatio, width: el.clientWidth };

		// 1. Live-Strich auf leerer Fläche: 200 bzw. 1000 Punkte
		setStrokes([], 1400);
		await settle();
		out.live200_empty = await liveStroke(200, 120);
		setStrokes([], 1400);
		await settle();
		out.live1000_empty = await liveStroke(1000, 120);

		// 2. Viele Striche: volles Neuzeichnen (kalt = Pfade neu, warm = Pfade gecacht), Live-Strich darüber,
		//    Strich abschließen, Neu-Laden (fremde Änderung)
		for (const count of [500, 5000]) {
			const H = 1400;
			seed = 7;
			const strokes = fill(count, H);
			setStrokes(strokes, H);
			await settle();
			const r = {};
			// kalt: neue Strich-Objekte (wie nach dem Laden) – Pfade müssen neu berechnet werden
			entry.doc.strokes = strokes.map((s) => ({ ...s, points: s.points.slice() }));
			let t0 = performance.now();
			surface.redrawAll();
			flush();
			r.redrawAllCold = +(performance.now() - t0).toFixed(2);
			const warm = [];
			for (let i = 0; i < 5; i++) {
				t0 = performance.now();
				surface.redrawAll();
				flush();
				warm.push(performance.now() - t0);
			}
			r.redrawAllWarm = median(warm);
			const live = await liveStroke(200, 300);
			r.live200_moveAtEnd = live.moveAtEnd;
			r.live200_moveFirst50 = live.moveFirst50;
			r.finishStroke = live.finish;
			const live2 = await liveStroke(1000, 500);
			r.live1000_moveAtEnd = live2.moveAtEnd;
			r.finishStroke1000 = live2.finish;
			// Fremde Änderung (Sync/Tandem): Datei bekommt von außen einen Strich dazu → Lesen, Zusammenführen,
			// Neumalen. Gemessen vom Schreiben bis zum gemalten Ergebnis.
			plugin.store.touch(entry);
			await plugin.store.flush(entry.path);
			const file = app.vault.getFileByPath(entry.path);
			const reloads = [];
			for (let i = 0; i < 3; i++) {
				const raw = JSON.parse(await app.vault.read(file));
				const q = raw.q ?? 10;
				const sp = handStroke(100 + i * 50, 200, 40, "x").points;
				const enc = [];
				for (let j = 0; j < sp.length; j += 3) {
					const prev = j ? [Math.round(sp[j - 3] * q), Math.round(sp[j - 2] * q), Math.round(sp[j - 1] * 255)] : [0, 0, 0];
					enc.push(Math.round(sp[j] * q) - prev[0], Math.round(sp[j + 1] * q) - prev[1], Math.round(sp[j + 2] * 255) - prev[2]);
				}
				raw.strokes.push({ id: `r${count}-${i}`, t: "pen", c: 0, s: 3, p: enc });
				const before = entry.doc.strokes.length;
				t0 = performance.now();
				await app.vault.modify(file, JSON.stringify(raw));
				while (entry.doc.strokes.length === before && performance.now() - t0 < 5000) await frame();
				// bis alle Kacheln im Bild wieder gemalt sind (neu angelegte Kacheln malen erst, wenn sichtbar)
				const ready = () =>
					[...el.querySelectorAll("canvas.ink-tile")].every((c) => {
						const r = c.getBoundingClientRect();
						return r.bottom < 0 || r.top > innerHeight || c.width === Math.round(el.clientWidth * devicePixelRatio);
					});
				do await frame();
				while (!ready() && performance.now() - t0 < 5000);
				flush();
				reloads.push(performance.now() - t0);
				await settle();
			}
			r.reloadToPainted = median(reloads);
			// Eigenes Speichern (Kodieren + Schreiben + eigenes modify-Ereignis)
			const saves = [];
			for (let i = 0; i < 3; i++) {
				entry.doc.strokes.push(handStroke(100, 600 + i * 20, 30, `w${count}-${i}`));
				plugin.store.touch(entry);
				t0 = performance.now();
				await plugin.store.flush(entry.path);
				saves.push(performance.now() - t0);
				await settle();
			}
			r.save = median(saves);
			// Radieren (ganze Striche): Bewegung quer über die Fläche
			plugin.settings.tools.tool = "eraser";
			const et = [];
			el.dispatchEvent(ev("pointerdown", 50, 50));
			for (let i = 1; i <= 200; i++) {
				const e = ev("pointermove", 50 + i * 4, 50 + i * 3);
				t0 = performance.now();
				el.dispatchEvent(e);
				flush();
				et.push(performance.now() - t0);
			}
			el.dispatchEvent(ev("pointerup", 850, 650));
			plugin.settings.tools.tool = "pen";
			r.eraseMove = median(et);
			await settle();
			out[`strokes${count}`] = r;
		}

		// 3. Fremder Live-Strich (api.setRemoteStroke) mit wachsender Punktzahl
		setStrokes([], 1400);
		await settle();
		const remote = [];
		const pts = [];
		for (let i = 0; i < 1000; i++) {
			const t = i / 6;
			pts.push(60 + i * 0.8, 300 + 9 * Math.sin(t), 0.5);
			const t0 = performance.now();
			plugin.api.setRemoteStroke(entry.path, "peer", { id: "remote1", tool: "pen", color: 0, size: 3, points: pts }, { name: "Peer", color: "#e03131" });
			remote.push(performance.now() - t0);
		}
		plugin.api.clearRemote("peer");
		out.remoteStroke1000_atEnd = median(remote.slice(-50));
		out.remoteStroke1000_total = +remote.reduce((a, b) => a + b, 0).toFixed(1);
		return out;
	}, ID);

	console.log(JSON.stringify(results, null, 2));
	const outDir = resolve(import.meta.dirname, "../../../e2e-out");
	await mkdir(outDir, { recursive: true });
	await writeFile(resolve(outDir, process.env.PERF_OUT ?? "perf-ink.json"), JSON.stringify(results, null, 2));
};
