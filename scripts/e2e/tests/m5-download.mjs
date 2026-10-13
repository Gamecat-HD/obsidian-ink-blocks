// M5: Modelle fehlen → Hinweis; Download (hier über einen lokalen Server statt Hugging Face/jsDelivr) mit
// gepinnten URLs und Prüfsumme; manipulierte Datei wird abgelehnt.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
const ID = "obsidian-ink-blocks";

export const options = { models: false };

export default async (h) => {
	h.evalTimeout = 90000;
	const served = [];
	let corrupt = false;
	const server = createServer(async (req, res) => {
		const u = new URL(req.url, "http://x").searchParams.get("u") ?? "";
		served.push(u);
		const name = u.split("/").pop();
		const file = u.includes("ort-wasm") ? `ort/${name}` : u.includes("de-htr-web-v2") ? `de-htr-web-v2/${name}` : `de-htr-web/${name}`;
		try {
			res.end(corrupt ? "manipuliert" : await readFile(resolve("models", file)));
		} catch {
			res.statusCode = 404;
			res.end();
		}
	});
	await new Promise((r) => server.listen(0, "127.0.0.1", r));
	const port = server.address().port;
	const notices = () => h.evaluate(() => [...document.querySelectorAll(".notice")].map((n) => n.textContent).join(" | "));
	const download = async () => {
		await h.evaluate(() => document.querySelectorAll(".notice").forEach((n) => n.remove()));
		await h.evaluate(() => app.commands.executeCommandById("obsidian-ink-blocks:download-models"));
		await h.waitFor(async () => /bereit|fehlgeschlagen/.test(await notices()), { timeout: 60000, what: "Download" });
		return notices();
	};

	try {
		// Ohne Modelle: Erkennung meldet sich mit Hinweis statt zu laden
		const outcome = await h.evaluate(async (id) => {
			const p = app.plugins.plugins[id];
			const entry = { path: "x.ink", doc: { v: 1, id: "x", space: "nb", w: 1000, h: 400, strokes: [] }, dirty: false };
			return p.ocr.run({ entry, inkPath: "x.ink", notePath: "Notiz.md", hint: () => undefined, busy: () => false }, true);
		}, ID);
		assert.equal(outcome, "no-models");
		assert.match(await notices(), /Modelle fehlen/);

		await h.evaluate((id, port) => {
			app.plugins.plugins[id].dev.rewriteUrl = (u) => `http://127.0.0.1:${port}/?u=${encodeURIComponent(u)}`;
		}, ID, port);

		// Manipulierte Datei → abgelehnt, nichts geschrieben
		corrupt = true;
		assert.match(await download(), /Prüfsumme stimmt nicht/);
		corrupt = false;

		// Echter Download
		served.length = 0;
		assert.match(await download(), /Texterkennung bereit/);
		assert.equal(served.length, 3, served.join("\n"));
		assert.ok(served.some((u) => u.startsWith("https://huggingface.co/naeyn/de-htr-web-v2/resolve/6241c1ff")));
		assert.ok(served.some((u) => u === "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist/ort-wasm-simd-threaded.wasm"));
		assert.deepEqual(await h.evaluate((id) => app.plugins.plugins[id].ocr.readyEngines(), ID), ["htr-v2"]);

		// Zweiter Download lädt nichts erneut
		served.length = 0;
		await download();
		assert.equal(served.length, 0);
	} finally {
		server.close();
	}
};
