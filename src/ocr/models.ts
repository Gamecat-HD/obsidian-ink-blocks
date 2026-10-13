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

export type EngineId = "htr-v2" | "htr-v1";

export interface EngineSpec {
	id: EngineId;
	label: string;
	model: ModelFile;
	config: ModelFile;
}

const HF = "https://huggingface.co";

/** onnxruntime-Wasm passend zur gebündelten JS-Version (Version kommt aus package.json). */
export const ORT_WASM: ModelFile = {
	path: "ort/ort-wasm-simd-threaded.wasm",
	url: `https://cdn.jsdelivr.net/npm/onnxruntime-web@${__ORT_VERSION__}/dist/ort-wasm-simd-threaded.wasm`,
	sha256: "3398c10d07d229bd91b364548e130e0e51a8e5704b88c7c083ebbeb78842dee2",
	size: 14239897,
};

/** Gepinnte Hugging-Face-Commits – die Dateien hinter den URLs können sich nicht mehr ändern. */
export const ENGINES: Record<EngineId, EngineSpec> = {
	"htr-v2": {
		id: "htr-v2",
		label: "de-htr-web-v2",
		model: {
			path: "de-htr-web-v2/model.onnx",
			url: `${HF}/naeyn/de-htr-web-v2/resolve/6241c1ff0fd42725e0dc46fcd3217469cac851bb/model.onnx`,
			sha256: "b576a0a1281b9be46b2574028b75575e041b7d7cb650f063886e733467cc1499",
			size: 10396365,
		},
		config: {
			path: "de-htr-web-v2/config.json",
			url: `${HF}/naeyn/de-htr-web-v2/resolve/6241c1ff0fd42725e0dc46fcd3217469cac851bb/config.json`,
			sha256: "4ebd69d9d27b398ea3997b031318accc13123f6a8950def1fedc6e364cb758fa",
			size: 1362,
		},
	},
	"htr-v1": {
		id: "htr-v1",
		label: "de-htr-web (v1)",
		model: {
			path: "de-htr-web/model.onnx",
			url: `${HF}/naeyn/de-htr-web/resolve/8b0350ccd9bbc741977fee79ac40ea1ed37633e7/model.onnx`,
			sha256: "05cce04d3938a64edaee79caf2a74587eaa9f8c46c146d6e04f0512bfce51d82",
			size: 9843872,
		},
		config: {
			path: "de-htr-web/config.json",
			url: `${HF}/naeyn/de-htr-web/resolve/8b0350ccd9bbc741977fee79ac40ea1ed37633e7/config.json`,
			sha256: "d4889234f69329e5e0b834c96a06dc084e5fa44658968168940844e389560a79",
			size: 604,
		},
	},
};

export function engineFiles(spec: EngineSpec): ModelFile[] {
	return [spec.model, spec.config, ORT_WASM];
}

/** Lädt Modelldateien einmalig in den Plugin-Ordner und liest sie von dort (danach offline). */
export class ModelStore {
	constructor(private readonly plugin: InkBlocksPlugin) {}

	private abs(file: ModelFile) {
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
