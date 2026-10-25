// Messung auf echter Handschrift (scripts/bench/real/*.ink + truth.json) mit der echten Pipeline im isolierten
// Obsidian: Segmentierung → Rasterung → de-htr-web-v2 → Decoder. Vergleicht Varianten von Rasterung und Decoder.
//
// Aufruf: npm run build && node scripts/bench/real.mjs [variants.json] [--vault <Pfad>] [--show]
//   --vault: Markdown-Dateien (ohne .obsidian) dieses Vaults kommen mit ins Sprachmodell, wie im echten Betrieb.
//   variants.json: [{ "name": "...", "raster": {...}, "decoder": {...}, "lm": true }, …]; ohne → eingebaute Liste.
import { cp, mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { launch } from "../e2e/harness.mjs";

const REPO = resolve(import.meta.dirname, "../..");
const REAL = join(REPO, "scripts/bench/real");
const args = process.argv.slice(2);
const vaultArg = args.includes("--vault") ? args[args.indexOf("--vault") + 1] : null;
const show = args.includes("--show");
const variantsFile = args.find((a, i) => a.endsWith(".json") && args[i - 1] !== "--vault");

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

const h = await launch({ vaultTemplate: template });
h.evalTimeout = 600000;
try {
	const results = await h.evaluate(
		async ({ files, truth, variants, base }) => {
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
		{ files, truth, variants: VARIANTS, base: BASE },
	);
	for (const r of results) {
		console.log(`${(r.cer * 100).toFixed(1).padStart(5)} % CER  ${String(r.errors).padStart(3)} Fehler  ${String(r.ms).padStart(6)} ms  ${r.name}`);
		if (show) for (const row of r.rows) console.log(`      ${String(row.e).padStart(2)}  ${row.got}   [${row.want}]`);
	}
} finally {
	await h.close();
	await rm(template, { recursive: true, force: true });
}
