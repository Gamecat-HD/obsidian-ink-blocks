// Spike S1: onnxruntime-web (wasm-Bundle) in einem Blob-Modul-Worker in Obsidian, de-htr-web-v2 auf einer synthetischen Zeile.
import assert from "node:assert/strict";
import esbuild from "esbuild";

const WORKER = `
import * as ort from "onnxruntime-web/wasm";
let session, cfg;
self.onmessage = async ({ data }) => {
  try {
    if (data.type === "init") {
      ort.env.wasm.wasmBinary = data.wasm;
      ort.env.wasm.numThreads = 1;
      ort.env.wasm.proxy = false;
      const t0 = performance.now();
      session = await ort.InferenceSession.create(new Uint8Array(data.model), { executionProviders: ["wasm"] });
      cfg = data.cfg;
      self.postMessage({ ok: true, loadMs: performance.now() - t0, inputs: session.inputNames, outputs: session.outputNames });
    } else {
      const { gray, w, h } = data;
      const t0 = performance.now();
      const out = await session.run({ [cfg.input_name]: new ort.Tensor("float32", gray, [1, 1, h, w]) });
      const logits = out[cfg.output_name];
      const d = logits.dims; const C = d[2]; const T = d[0] === 1 ? d[1] : d[0];
      const valid = Math.min(Math.ceil(data.realW / cfg.output_stride), T);
      let prev = 0, text = "";
      for (let t = 0; t < valid; t++) {
        let best = 0, bv = -Infinity;
        for (let c = 0; c < C; c++) { const v = logits.data[t * C + c]; if (v > bv) { bv = v; best = c; } }
        if (best !== prev && best !== 0) text += cfg.alphabet[best - 1];
        prev = best;
      }
      self.postMessage({ ok: true, ms: performance.now() - t0, dims: logits.dims, text });
    }
  } catch (e) { self.postMessage({ ok: false, error: String(e && e.stack || e) }); }
};`;

export default async (h) => {
	const built = await esbuild.build({
		stdin: { contents: WORKER, resolveDir: process.cwd(), loader: "js" },
		bundle: true, format: "esm", platform: "browser", write: false, minify: true,
	});
	const code = built.outputFiles[0].text;
	console.log(`Worker-Bundle: ${(code.length / 1024).toFixed(0)} KB`);

	const res = await h.evaluate(async (code) => {
		const dir = app.plugins.plugins["obsidian-ink-blocks"].manifest.dir;
		const a = app.vault.adapter;
		const wasm = await a.readBinary(`${dir}/models/ort/ort-wasm-simd-threaded.wasm`);
		const model = await a.readBinary(`${dir}/models/de-htr-web-v2/model.onnx`);
		const cfg = JSON.parse(await a.read(`${dir}/models/de-htr-web-v2/config.json`));
		const url = URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
		const worker = new Worker(url, { type: "module" });
		const call = (msg, transfer = []) => new Promise((ok) => { worker.onmessage = (e) => ok(e.data); worker.onerror = (e) => ok({ ok: false, error: "onerror: " + e.message }); worker.postMessage(msg, transfer); });
		const init = await call({ type: "init", wasm, model, cfg }, [wasm, model]);
		if (!init.ok) return { init };

		const runs = [];
		for (const [text, font] of [["Hallo Welt", "44px cursive"], ["Hallo Welt", "44px cursive"], ["Subnetzmaske 255.255.255.0", "44px sans-serif"], ["Größe über Maß", "44px cursive"]]) {
			const c = new OffscreenCanvas(1400, 64), g = c.getContext("2d");
			g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
			g.fillStyle = "#000"; g.font = font; g.textBaseline = "middle";
			const realW = Math.ceil(g.measureText(text).width) + 16;
			g.fillText(text, 8, 34);
			const w = Math.min(1024, Math.ceil(realW / 4) * 4);
			const px = g.getImageData(0, 0, w, 64).data;
			const gray = new Float32Array(w * 64);
			for (let i = 0; i < gray.length; i++) gray[i] = (px[i * 4] + px[i * 4 + 1] + px[i * 4 + 2]) / 3 / 255;
			const r = await call({ type: "run", gray, w, h: 64, realW: Math.min(realW, w) }, [gray.buffer]);
			runs.push({ want: text, ...r });
		}
		worker.terminate();
		return { init, runs };
	}, code);
	console.log("S1", JSON.stringify(res, null, 1));
	assert.ok(res.init.ok, res.init.error);
	assert.ok(res.runs.every((r) => r.ok));
};
