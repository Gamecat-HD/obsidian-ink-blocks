import { normalizePath, requestUrl } from "obsidian";
import type InkBlocksPlugin from "../main";
import { sha256Hex } from "../util/hash";

export interface ModelFile {
	/** Pfad relativ zu `<plugin>/models/` */
	path: string;
	url: string;
	sha256: string;
	size: number;
}

export type EngineId = "htr-v2" | "htr-v1" | "tesseract";

export interface EngineSpec {
	id: EngineId;
	label: string;
	/** Alle Dateien, die die Engine braucht (Grundlage für Download und Bereitschaft). */
	files: ModelFile[];
}

export interface HtrSpec extends EngineSpec {
	model: ModelFile;
	config: ModelFile;
}

const HF = "https://huggingface.co";
const JSD = "https://cdn.jsdelivr.net/npm";

/** onnxruntime-Wasm passend zur gebündelten JS-Version (Version kommt aus package.json). */
export const ORT_WASM: ModelFile = {
	path: "ort/ort-wasm-simd-threaded.wasm",
	url: `${JSD}/onnxruntime-web@${__ORT_VERSION__}/dist/ort-wasm-simd-threaded.wasm`,
	sha256: "3398c10d07d229bd91b364548e130e0e51a8e5704b88c7c083ebbeb78842dee2",
	size: 14239897,
};

function htr(id: "htr-v2" | "htr-v1", label: string, repo: string, dir: string, commit: string, model: [string, number], config: [string, number]): HtrSpec {
	const file = (name: string, [sha256, size]: [string, number]): ModelFile => ({
		path: `${dir}/${name}`,
		url: `${HF}/${repo}/resolve/${commit}/${name}`,
		sha256,
		size,
	});
	const m = file("model.onnx", model);
	const c = file("config.json", config);
	return { id, label, model: m, config: c, files: [m, c, ORT_WASM] };
}

/** Gepinnte Versionen/Commits – die Dateien hinter den URLs können sich nicht mehr ändern. */
export const HTR_V2 = htr("htr-v2", "de-htr-web-v2", "naeyn/de-htr-web-v2", "de-htr-web-v2", "6241c1ff0fd42725e0dc46fcd3217469cac851bb",
	["b576a0a1281b9be46b2574028b75575e041b7d7cb650f063886e733467cc1499", 10396365],
	["4ebd69d9d27b398ea3997b031318accc13123f6a8950def1fedc6e364cb758fa", 1362]);

/** v2 ungerechnet (fp32, 40 MB) statt int8 – derselbe Commit und dieselbe config.json. */
export const HTR_V2_FP32: HtrSpec = (() => {
	const m: ModelFile = { ...HTR_V2.model, path: HTR_V2.model.path.replace(/model\.onnx$/, "model-fp32.onnx"), url: HTR_V2.model.url.replace(/model\.onnx$/, "model-fp32.onnx"),
		sha256: "68b46411b8236b44d0d98865909d217ef13b41f12db769993c67eeb8d6e8c45a", size: 40259857 };
	return { ...HTR_V2, label: "de-htr-web-v2 schnell (fp32)", model: m, files: [m, HTR_V2.config, ORT_WASM] };
})();

export const HTR_V1 = htr("htr-v1", "de-htr-web (v1)", "naeyn/de-htr-web", "de-htr-web", "8b0350ccd9bbc741977fee79ac40ea1ed37633e7",
	["05cce04d3938a64edaee79caf2a74587eaa9f8c46c146d6e04f0512bfce51d82", 9843872],
	["d4889234f69329e5e0b834c96a06dc084e5fa44658968168940844e389560a79", 604]);

/** tesseract.js wird nicht gebündelt, sondern wie die Modelle geladen (UMD-Bibliothek, Worker, Wasm-Kern, Sprachdaten). */
export const TESSERACT = {
	id: "tesseract" as const,
	label: "Tesseract.js (deu)",
	lib: { path: "tesseract/tesseract.min.js", url: `${JSD}/tesseract.js@7.0.0/dist/tesseract.min.js`, sha256: "000c27d9cd0def655f77b36c72a389c0ab13793aa31cb4d7aab56d09c0afbc7e", size: 62961 },
	worker: { path: "tesseract/worker.min.js", url: `${JSD}/tesseract.js@7.0.0/dist/worker.min.js`, sha256: "576b7df7e3393e137e51849357c9adb53fe7ac1bb69bfa06cf3d61520f182c6d", size: 111307 },
	core: { path: "tesseract/tesseract-core-simd-lstm.wasm.js", url: `${JSD}/tesseract.js-core@7.0.0/tesseract-core-simd-lstm.wasm.js`, sha256: "c58b46a4c796c0b8afccf77591d5b875b6896b45d402bbce8caa6f5362447b38", size: 3899472 },
	lang: { path: "tesseract/deu.traineddata.gz", url: `${JSD}/@tesseract.js-data/deu@1.0.0/4.0.0_best_int/deu.traineddata.gz`, sha256: "306c4280d0cbed46fbff727486bd43b92730181bae80f56941a091f363bdf28b", size: 1333102 },
	get files(): ModelFile[] {
		return [this.lib, this.worker, this.core, this.lang];
	},
};

export const ENGINES: Record<EngineId, EngineSpec> = { "htr-v2": HTR_V2, "htr-v1": HTR_V1, tesseract: TESSERACT };
/** Reihenfolge für „Automatisch“. */
export const ENGINE_ORDER: EngineId[] = ["htr-v2", "htr-v1", "tesseract"];

export function engineFiles(spec: EngineSpec): ModelFile[] {
	return spec.files;
}

/** Lädt Modelldateien einmalig in den Plugin-Ordner und liest sie von dort (danach offline). */
export class ModelStore {
	constructor(private readonly plugin: InkBlocksPlugin) {}

	abs(file: ModelFile) {
		return normalizePath(`${this.plugin.manifest.dir}/models/${file.path}`);
	}

	/** Alle Dateien vorhanden und in erwarteter Größe? */
	async isReady(spec: EngineSpec): Promise<boolean> {
		const adapter = this.plugin.app.vault.adapter;
		for (const file of engineFiles(spec)) {
			const stat = await adapter.stat(this.abs(file));
			if (!stat || stat.size !== file.size) return false;
		}
		return true;
	}

	/** URL, unter der der Renderer (und Worker) eine Datei/einen Ordner im Plugin lesen kann – ohne Query. */
	resourceUrl(vaultPath: string): string {
		return this.plugin.app.vault.adapter.getResourcePath(vaultPath).replace(/\?.*$/, "");
	}

	async read(file: ModelFile): Promise<ArrayBuffer> {
		return this.plugin.app.vault.adapter.readBinary(this.abs(file));
	}

	/** Fehlende Dateien herunterladen und per SHA-256 prüfen. `onProgress` bekommt den Dateinamen. */
	async download(spec: EngineSpec, onProgress?: (file: ModelFile, index: number, total: number) => void) {
		const adapter = this.plugin.app.vault.adapter;
		const files = engineFiles(spec);
		for (const [i, file] of files.entries()) {
			const target = this.abs(file);
			const stat = await adapter.stat(target);
			if (stat?.size === file.size) continue;
			onProgress?.(file, i, files.length);
			const url = this.plugin.dev.rewriteUrl?.(file.url) ?? file.url;
			const res = await requestUrl({ url, throw: false });
			if (res.status !== 200) throw new Error(`${file.path}: HTTP ${res.status}`);
			const hash = await sha256Hex(res.arrayBuffer);
			if (hash !== file.sha256) throw new Error(`${file.path}: Prüfsumme stimmt nicht`);
			const dir = target.split("/").slice(0, -1).join("/");
			if (!(await adapter.exists(dir))) await adapter.mkdir(dir);
			await adapter.writeBinary(target, res.arrayBuffer);
		}
	}
}
