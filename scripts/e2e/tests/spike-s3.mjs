// Spike S3: tesseract.js komplett aus lokalen Dateien (kein CDN) in Obsidian.
// Hinweis: tesseract.js 7 hat einen Bug bei {code, data}-Sprachobjekten (initialize nutzt l.data als Namen).
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

export default async (h) => {
	h.evalTimeout = 40000;
	const lib = await readFile("node_modules/tesseract.js/dist/tesseract.esm.min.js", "utf8");
	const worker = await readFile("node_modules/tesseract.js/dist/worker.min.js", "utf8");
	const core = await readFile("node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js", "utf8");
	const res = await h.evaluate(async (lib, worker, core) => {
		const dir = app.plugins.plugins["obsidian-ink-blocks"].manifest.dir;
		const blob = (s) => URL.createObjectURL(new Blob([s], { type: "text/javascript" }));
		const T = await import(blob(lib));
		const Tesseract = T.default ?? T;
		const base = { workerPath: blob(worker), corePath: blob(core) + "#core.js", workerBlobURL: false };
		const c = document.createElement("canvas"); c.width = 700; c.height = 80;
		const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, 700, 80);
		g.fillStyle = "#000"; g.font = "40px sans-serif"; g.fillText("Größe über Maß 255.255.0.0", 10, 55);
		const out = {};
		const attempt = async (name, langOpts) => {
			const t0 = performance.now();
			try {
				const w = await Promise.race([
					Tesseract.createWorker("deu", 1, { ...base, ...langOpts }),
					new Promise((_, f) => setTimeout(() => f(new Error("timeout")), 15000)),
				]);
				const loadMs = performance.now() - t0;
				const t1 = performance.now();
				const r = await w.recognize(c);
				out[name] = { loadMs, ms: performance.now() - t1, text: r.data.text.trim() };
				await w.terminate();
			} catch (e) { out[name] = { error: String(e) }; }
		};
		// A: app://-Ressourcen-URL als langPath
		const res = app.vault.adapter.getResourcePath(`${dir}/models/tesseract`).replace(/\?.*$/, "");
		out.resUrl = res;
		await attempt("A_resourceUrl", { langPath: res, cacheMethod: "none" });
		// B: IndexedDB-Cache von tesseract (idb-keyval: DB keyval-store / Store keyval) vorbefüllen
		const gz = await app.vault.adapter.readBinary(`${dir}/models/tesseract/deu.traineddata.gz`);
		const raw = new Uint8Array(await new Response(new Blob([gz]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer());
		await new Promise((ok, fail) => {
			const req = indexedDB.open("keyval-store");
			req.onupgradeneeded = () => req.result.createObjectStore("keyval");
			req.onsuccess = () => { const tx = req.result.transaction("keyval", "readwrite"); tx.objectStore("keyval").put(raw, "ink-blocks/deu.traineddata"); tx.oncomplete = ok; tx.onerror = fail; };
			req.onerror = fail;
		});
		await attempt("B_indexedDb", { cachePath: "ink-blocks", cacheMethod: "readOnly", langPath: "http://127.0.0.1:9/offline" });
		return out;
	}, lib, worker, core);
	console.log("S3", JSON.stringify(res, null, 1));
	assert.ok(res.A_resourceUrl.text || res.B_indexedDb.text, "keine Variante erfolgreich");
};
