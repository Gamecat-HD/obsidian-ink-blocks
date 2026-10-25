// Rasterung tunen auf vielen fremden Schreibern: ScaDS-Testzeilen (Split von naeyn/de-htr-web, Schreiber nicht im
// Training) werden binarisiert, skelettiert (Zhang-Suen) und als Striche durch dieselbe Rasterung wie Stift-Striche
// geschickt. Das ahmt „Stiftspur → Zeilenbild“ nach, ohne dass es zu den Zeilen echte Stiftdaten gibt.
//
// Aufruf: npm run build && node scripts/bench/scads.mjs <scads-Ordner> <split_manifest.json> [Anzahl=300] [variants.json]
//   scads-Ordner: entpacktes Zenodo-Archiv 18301532 (images/lines); Soll-Texte und Split aus split_manifest.json
//   (huggingface.co/naeyn/de-htr-web, training-data/split_manifest.json)
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { launch } from "../e2e/harness.mjs";

const REPO = resolve(import.meta.dirname, "../..");
const [scadsDir, manifestPath, countArg, variantsFile] = process.argv.slice(2);
const count = Number(countArg ?? 300);
const BASE = { strokePx: [2.6] };
const VARIANTS = variantsFile
	? JSON.parse(await readFile(variantsFile, "utf8"))
	: [{ name: "Standard (v2 fp32 + v1)" }, { name: "nur v2", ensemble: 0 }, { name: "nur v1", engine: "htr-v1" }];

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const lines = manifest.lines.test.map((l) => ({ id: l.id, file: l.image.split("/").pop(), text: l.text.normalize("NFC") }));
// Feste, über alle Schreiber gestreute Auswahl.
lines.sort((a, b) => a.id.localeCompare(b.id));
const step = Math.max(1, Math.floor(lines.length / count));
const pick = lines.filter((_, i) => i % step === 0).slice(0, count);

const template = await mkdtemp(join(tmpdir(), "ink-bench-scads-"));
await cp(join(REPO, "test-vault"), template, { recursive: true });
await mkdir(join(template, "_scads"), { recursive: true });
for (const l of pick) await cp(join(scadsDir, "images/lines", l.file), join(template, "_scads", l.file));
await writeFile(join(template, "_scads/truth.json"), JSON.stringify(pick));

const h = await launch({ vaultTemplate: template });
h.evalTimeout = 3_600_000;
try {
	const results = await h.evaluate(
		async ({ variants, base }) => {
			const plugin = app.plugins.plugins["obsidian-ink-blocks"];
			const ocr = plugin.ocr;
			const pick = JSON.parse(await app.vault.adapter.read("_scads/truth.json"));

			// Binarisieren + Zhang-Suen-Ausdünnung → Skelettpixel als 2-Punkt-Striche (Nachbarn O, SO, S, SW).
			const segments = [];
			for (const l of pick) {
				const buf = await app.vault.adapter.readBinary(`_scads/${l.file}`);
				const bmp = await createImageBitmap(new Blob([buf]));
				const cv = new OffscreenCanvas(bmp.width, bmp.height);
				const cx = cv.getContext("2d");
				cx.drawImage(bmp, 0, 0);
				const { data, width: W, height: H } = cx.getImageData(0, 0, bmp.width, bmp.height);
				const img = new Uint8Array(W * H);
				for (let i = 0; i < W * H; i++) img[i] = data[i * 4] < 128 ? 1 : 0;
				const at = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : img[y * W + x]);
				for (let changed = true; changed; ) {
					changed = false;
					for (const pass of [0, 1]) {
						const del = [];
						for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
							if (!img[y * W + x]) continue;
							const p = [at(x, y - 1), at(x + 1, y - 1), at(x + 1, y), at(x + 1, y + 1), at(x, y + 1), at(x - 1, y + 1), at(x - 1, y), at(x - 1, y - 1)];
							const b = p.reduce((s, v) => s + v, 0);
							if (b < 2 || b > 6) continue;
							let a = 0;
							for (let k = 0; k < 8; k++) if (!p[k] && p[(k + 1) % 8]) a++;
							if (a !== 1) continue;
							if (pass === 0 ? p[0] * p[2] * p[4] || p[2] * p[4] * p[6] : p[0] * p[2] * p[6] || p[0] * p[4] * p[6]) continue;
							del.push(y * W + x);
						}
						for (const i of del) img[i] = 0;
						if (del.length) changed = true;
					}
				}
				const strokes = [];
				let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
				for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
					if (!img[y * W + x]) continue;
					minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
					let linked = false;
					for (const [dx, dy] of [[1, 0], [1, 1], [0, 1], [-1, 1]]) if (at(x + dx, y + dy)) (strokes.push([x, y, 0.5, x + dx, y + dy, 0.5]), (linked = true));
					if (!linked) strokes.push([x, y, 0.5]);
				}
				if (!strokes.length) continue;
				const box = { minX, minY, maxX, maxY };
				segments.push({ text: l.text, seg: { strokes, box, refHeight: (maxY - minY) / 1.4 } });
			}

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
			const out = [];
			const decoderDefaults = { ...ocr.decoderParams };
			const defaultWeight = ocr.ensembleWeight;
			for (const v of variants) {
				ocr.raster = { ...base, ...(v.raster ?? {}) };
				ocr.decoderParams = { ...decoderDefaults, ...(v.decoder ?? {}) };
				ocr.ensembleWeight = v.ensemble ?? defaultWeight;
				ocr.v2Precision = v.fp32 === false ? "int8" : v.fp32 ? "fp32" : "auto";
				plugin.settings.ocrLanguageModel = v.lm === true;
				ocr.reset();
				plugin.settings.ocrEngine = v.engine ?? "auto";
				const engine = await ocr.pickEngine();
				let errors = 0;
				let chars = 0;
				const t0 = performance.now();
				for (let i = 0; i < segments.length; i += 20) {
					const batch = segments.slice(i, i + 20);
					const res = await engine.recognize(batch.map((s) => ({ ...s.seg, raster: ocr.raster })));
					batch.forEach((s, k) => {
						errors += dist(norm(res[k].text), norm(s.text));
						chars += norm(s.text).length;
					});
				}
				out.push({ name: v.name, cer: errors / chars, errors, chars, n: segments.length, ms: Math.round(performance.now() - t0) });
			}
			return out;
		},
		{ variants: VARIANTS, base: BASE },
	);
	for (const r of results) console.log(`${(r.cer * 100).toFixed(2).padStart(6)} % CER  ${r.errors}/${r.chars}  n=${r.n}  ${String(r.ms).padStart(6)} ms  ${r.name}`);
} finally {
	await h.close();
	await rm(template, { recursive: true, force: true });
}
