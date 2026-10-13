// Lädt die OCR-Modelle für Entwicklung/E2E nach models/ (mit SHA-256-Prüfung).
// Das Plugin selbst lädt sie später zur Laufzeit in seinen eigenen Ordner (Meilenstein M5).
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const HF = "https://huggingface.co";
const FILES = [
	["de-htr-web-v2/model.onnx", `${HF}/naeyn/de-htr-web-v2/resolve/main/model.onnx`, "b576a0a1281b9be46b2574028b75575e041b7d7cb650f063886e733467cc1499"],
	["de-htr-web-v2/config.json", `${HF}/naeyn/de-htr-web-v2/resolve/main/config.json`, "4ebd69d9d27b398ea3997b031318accc13123f6a8950def1fedc6e364cb758fa"],
	["de-htr-web/model.onnx", `${HF}/naeyn/de-htr-web/resolve/main/model.onnx`, "05cce04d3938a64edaee79caf2a74587eaa9f8c46c146d6e04f0512bfce51d82"],
	["de-htr-web/config.json", `${HF}/naeyn/de-htr-web/resolve/main/config.json`, "d4889234f69329e5e0b834c96a06dc084e5fa44658968168940844e389560a79"],
	["tesseract/deu.traineddata.gz", "https://cdn.jsdelivr.net/npm/@tesseract.js-data/deu/4.0.0_best_int/deu.traineddata.gz", null],
];

const sha = (buf) => createHash("sha256").update(buf).digest("hex");

for (const [rel, url, hash] of FILES) {
	const target = resolve(ROOT, "models", rel);
	if (existsSync(target) && (!hash || sha(await readFile(target)) === hash)) {
		console.log(`ok       ${rel}`);
		continue;
	}
	const res = await fetch(url);
	if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
	const buf = Buffer.from(await res.arrayBuffer());
	if (hash && sha(buf) !== hash) throw new Error(`${rel}: SHA-256 stimmt nicht`);
	await mkdir(dirname(target), { recursive: true });
	await writeFile(target, buf);
	console.log(`geladen  ${rel} (${(buf.length / 1e6).toFixed(1)} MB)`);
}

// onnxruntime-Wasm passend zur installierten Version
const wasm = resolve(ROOT, "models/ort/ort-wasm-simd-threaded.wasm");
await mkdir(dirname(wasm), { recursive: true });
await copyFile(resolve(ROOT, "node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm"), wasm);
console.log("ok       ort/ort-wasm-simd-threaded.wasm (aus node_modules)");
