/** Gebündelter OCR-Worker als Quelltext (esbuild-Plugin in esbuild.config.mjs). */
declare module "virtual:ocr-worker" {
	const code: string;
	export default code;
}

/** Version von onnxruntime-web aus package.json – bestimmt die URL der passenden Wasm-Datei. */
declare const __ORT_VERSION__: string;
