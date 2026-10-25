// Zeilenbilder, wie das Modell sie sieht (64 px hoch), für alle Proben in scripts/bench/real → <Ausgabeordner>/.
// Aufruf: npm run build && node scripts/bench/real-images.mjs <Ausgabeordner> ['{"strokePx":[2.0]}']
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { launch } from "../e2e/harness.mjs";

const REPO = resolve(import.meta.dirname, "../..");
const REAL = join(REPO, "scripts/bench/real");
const [outDir, rasterJson] = process.argv.slice(2);
const raster = { strokePx: [2.6], ...(rasterJson ? JSON.parse(rasterJson) : {}) };
const truth = JSON.parse(await readFile(join(REAL, "truth.json"), "utf8"));
const files = Object.keys(truth).filter((k) => k.endsWith(".ink"));
const template = await mkdtemp(join(tmpdir(), "ink-bench-img-"));
await cp(join(REPO, "test-vault"), template, { recursive: true });
await mkdir(join(template, "_bench"), { recursive: true });
for (const f of files) await cp(join(REAL, f), join(template, "_bench", f));
await mkdir(outDir, { recursive: true });
const h = await launch({ vaultTemplate: template });
try {
	const images = await h.evaluate(async ({ files, raster }) => {
		const plugin = app.plugins.plugins["obsidian-ink-blocks"];
		const { segmentLines, referenceHeight, rasterizeSegment } = plugin.dev.ocr;
		const out = [];
		for (const f of files) {
			const doc = (await plugin.store.acquire(`_bench/${f}`, () => {})).doc;
			const refHeight = referenceHeight(doc.strokes.filter((s) => s.tool === "pen" && !s.shape));
			let n = 0;
			for (const line of segmentLines(doc.strokes)) for (const seg of line) {
				const { canvas } = rasterizeSegment({ strokes: seg.strokes.map((s) => s.points), box: seg.box, refHeight, raster }, 64, 1024).canvases[0];
				const buf = new Uint8Array(await (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer());
				let bin = "";
				for (const b of buf) bin += String.fromCharCode(b);
				out.push({ name: `${f.replace(/\.ink$/, "")}-${++n}.png`, b64: btoa(bin) });
			}
		}
		return out;
	}, { files, raster });
	for (const img of images) await writeFile(join(outDir, img.name), Buffer.from(img.b64, "base64"));
	console.log(images.map((i) => i.name).join("\n"));
} finally {
	await h.close();
	await rm(template, { recursive: true, force: true });
}
