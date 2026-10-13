import esbuild from "esbuild";
import process from "node:process";
import { builtinModules } from "node:module";
import { readFileSync } from "node:fs";

const prod = process.argv[2] === "production";
const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

/** Baut src/ocr/worker.ts separat (ESM) und stellt ihn als String-Modul `virtual:ocr-worker` bereit. */
const inlineWorker = {
	name: "inline-worker",
	setup(build) {
		build.onResolve({ filter: /^virtual:ocr-worker$/ }, () => ({ path: "ocr-worker", namespace: "inline-worker" }));
		build.onLoad({ filter: /.*/, namespace: "inline-worker" }, async () => {
			const result = await esbuild.build({
				entryPoints: ["src/ocr/worker.ts"],
				bundle: true,
				format: "esm",
				platform: "browser",
				target: "es2022",
				write: false,
				minify: prod,
				metafile: true,
				logLevel: "silent",
			});
			return {
				contents: `export default ${JSON.stringify(result.outputFiles[0].text)};`,
				loader: "js",
				watchFiles: Object.keys(result.metafile.inputs).map((f) => new URL(f, `file://${process.cwd()}/`).pathname),
			};
		});
	},
};

const context = await esbuild.context({
	entryPoints: ["src/main.ts"],
	bundle: true,
	plugins: [inlineWorker],
	define: { __ORT_VERSION__: JSON.stringify(pkg.dependencies["onnxruntime-web"]) },
	external: [
		"obsidian",
		"electron",
		"@codemirror/autocomplete",
		"@codemirror/collab",
		"@codemirror/commands",
		"@codemirror/language",
		"@codemirror/lint",
		"@codemirror/search",
		"@codemirror/state",
		"@codemirror/view",
		"@lezer/common",
		"@lezer/highlight",
		"@lezer/lr",
		...builtinModules,
	],
	format: "cjs",
	target: "es2022",
	logLevel: "info",
	sourcemap: prod ? false : "inline",
	treeShaking: true,
	outfile: "main.js",
	minify: prod,
});

if (prod) {
	await context.rebuild();
	process.exit(0);
} else {
	await context.watch();
}
