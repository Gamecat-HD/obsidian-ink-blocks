// Messung auf echter Handschrift (scripts/bench/real/*.ink + truth.json) mit der echten Pipeline im isolierten
// Obsidian: Segmentierung → Rasterung → de-htr-web-v2 → Decoder. Vergleicht Varianten von Rasterung und Decoder.
//
// Aufruf: npm run build && node scripts/bench/real.mjs [variants.json] [--vault <Pfad>] [--training <Ordner>] [--show]
//   --vault: Markdown-Dateien (ohne .obsidian) dieses Vaults kommen mit ins Sprachmodell, wie im echten Betrieb.
//   --training: zusätzlich die Proben des Schreibtrainings (samples-*.jsonl, z. B. <Vault>/_ink/_training) messen.
//   variants.json: [{ "name": "...", "raster": {...}, "decoder": {...}, "lm": true }, …]; ohne → eingebaute Liste.
import { cp, mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { launch } from "../e2e/harness.mjs";

const REPO = resolve(import.meta.dirname, "../..");
const REAL = join(REPO, "scripts/bench/real");
const args = process.argv.slice(2);
const vaultArg = args.includes("--vault") ? args[args.indexOf("--vault") + 1] : null;
const trainingArg = args.includes("--training") ? args[args.indexOf("--training") + 1] : null;
const show = args.includes("--show");
const variantsFile = args.find((a, i) => a.endsWith(".json") && args[i - 1] !== "--vault" && args[i - 1] !== "--training");

const BASE = { strokePx: [2.6] };
const VARIANTS = variantsFile
	? JSON.parse(await readFile(variantsFile, "utf8"))
	: [
			{ name: "Standard (v2 fp32 + v1, LM)" },
			{ name: "nur v2", ensemble: 0 },
			{ name: "nur v1", engine: "htr-v1" },
			{ name: "ohne LM", lm: false },
		];

/** Markdown-Dateien eines Vaults (rekursiv, ohne versteckte Ordner) in die Vorlage kopieren. */
async function copyMarkdown(from, to) {
	for (const e of await readdir(from, { withFileTypes: true })) {
		if (e.name.startsWith(".")) continue;
		const src = join(from, e.name);
		if (e.isDirectory()) await copyMarkdown(src, to);
		else if (e.name.endsWith(".md")) {
			const dst = join(to, "_korpus", relative(vaultArg, src));
			await mkdir(dirname(dst), { recursive: true });
			await cp(src, dst);
		}
	}
}

const template = await mkdtemp(join(tmpdir(), "ink-bench-real-"));
await cp(join(REPO, "test-vault"), template, { recursive: true });
await mkdir(join(template, "_bench"), { recursive: true });
const truth = JSON.parse(await readFile(join(REAL, "truth.json"), "utf8"));
const files = Object.keys(truth).filter((k) => k.endsWith(".ink"));
for (const f of files) await cp(join(REAL, f), join(template, "_bench", f));
if (vaultArg) await copyMarkdown(resolve(vaultArg), template);

/** Punkte wie in .ink: quantisiert (q = 10), Druck 0..255, delta-codiert (siehe src/model/ink-format.ts). */
function decodePoints(enc, q = 10) {
	const out = [];
	let x = 0, y = 0, p = 0;
	for (let i = 0; i < enc.length; i += 3) {
		x += enc[i];
		y += enc[i + 1];
		p += enc[i + 2];
		out.push(x / q, y / q, p / 255);
	}
	return out;
}

/** Beschriftete Proben des Schreibtrainings (letzte je Wort-Kennung, ohne „kein Text“). */
async function trainingItems(dir) {
	const byKey = new Map();
	const list = [];
	for (const name of (await readdir(dir)).filter((n) => /^samples.*\.jsonl$/.test(n)).sort()) {
		for (const line of (await readFile(join(dir, name), "utf8")).split("\n")) {
			if (!line.trim()) continue;
			try {
				const s = JSON.parse(line);
				if (typeof s.text !== "string" || !s.text.trim()) continue;
				const item = { f: `training:${s.id}`, want: s.text, strokes: s.p.map((p) => decodePoints(p)), at: s.at };
				if (s.key) byKey.set(s.key, item);
				else list.push(item);
			} catch {}
		}
	}
	return [...list, ...byKey.values()].sort((a, b) => a.at.localeCompare(b.at));
}
const training = trainingArg ? await trainingItems(resolve(trainingArg)) : [];
if (trainingArg) console.log(`${training.length} Proben aus dem Schreibtraining`);

const h = await launch({ vaultTemplate: template });
h.evalTimeout = 600000;
try {
	const results = await h.evaluate(
		async ({ files, truth, variants, base, training }) => {
			const plugin = app.plugins.plugins["obsidian-ink-blocks"];
			const ocr = plugin.ocr;
			const dist = (a, b) => {
				const d = Array.from({ length: b.length + 1 }, (_, j) => j);
				for (let i = 1; i <= a.length; i++) {
					let prev = d[0];
					d[0] = i;
					for (let j = 1; j <= b.length; j++) {
						const tmp = d[j];
						d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
						prev = tmp;
					}
				}
				return d[b.length];
			};
			const norm = (s) => s.replace(/\s+/g, " ").trim();
			const docs = [];
			for (const f of files) docs.push({ f, doc: (await plugin.store.acquire(`_bench/${f}`, () => {})).doc });
			for (const t of training) {
				truth[t.f] = t.want;
				docs.push({ f: t.f, doc: { strokes: t.strokes.map((points, i) => ({ id: `t${i}`, tool: "pen", color: 0, size: 3, points })) } });
			}
			const out = [];
			const decoderDefaults = { ...ocr.decoderParams };
			const defaultWeight = ocr.ensembleWeight;
			for (const v of variants) {
				ocr.raster = { ...base, ...(v.raster ?? {}) };
				ocr.decoderParams = { ...decoderDefaults, ...(v.decoder ?? {}) };
				ocr.ensembleWeight = v.ensemble ?? defaultWeight;
				ocr.v2Precision = v.fp32 === false ? "int8" : v.fp32 ? "fp32" : "auto";
				plugin.settings.ocrLanguageModel = v.lm !== false;
				plugin.settings.ocrEngine = v.engine ?? "auto";
				ocr.reset();
				let errors = 0;
				let chars = 0;
				const rows = [];
				const t0 = performance.now();
				for (const { f, doc } of docs) {
					const got = norm((await ocr.recognizeStrokes(doc.strokes)) ?? "");
					const want = norm(truth[f]);
					const e = dist(got, want);
					errors += e;
					chars += want.length;
					rows.push({ f, got, want, e });
				}
				out.push({ name: v.name, cer: errors / chars, errors, ms: Math.round(performance.now() - t0), rows });
			}
			return out;
		},
		{ files, truth, variants: VARIANTS, base: BASE, training },
	);
	for (const r of results) {
		console.log(`${(r.cer * 100).toFixed(1).padStart(5)} % CER  ${String(r.errors).padStart(3)} Fehler  ${String(r.ms).padStart(6)} ms  ${r.name}`);
		if (show) for (const row of r.rows) console.log(`      ${String(row.e).padStart(2)}  ${row.got}   [${row.want}]`);
	}
} finally {
	await h.close();
	await rm(template, { recursive: true, force: true });
}
