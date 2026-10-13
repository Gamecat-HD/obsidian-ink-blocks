// Aufruf: node scripts/e2e/run.mjs scripts/e2e/tests/<name>.mjs [--keep]
// Ein Test exportiert `default async (h) => {}` und wirft bei Fehlschlag. Optional `export const options`.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { launch } from "./harness.mjs";

const files = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const keep = process.argv.includes("--keep");
let failed = 0;

for (const file of files) {
	const mod = await import(pathToFileURL(resolve(file)).href);
	const h = await launch({ ...(mod.options ?? {}), keep });
	const t0 = Date.now();
	try {
		await mod.default(h);
		console.log(`PASS ${file} (${Date.now() - t0} ms)`);
	} catch (e) {
		failed++;
		console.log(`FAIL ${file}: ${e.stack ?? e}`);
		await h.screenshot(`fail-${file.split("/").pop()}.png`).catch(() => {});
	} finally {
		const relevant = h.logs.filter((l) => /ink|exception|error|tess/i.test(l));
		if (relevant.length) console.log(relevant.map((l) => `  ${l}`).join("\n"));
		if (keep) console.log(`  Vault behalten: ${h.vault}`);
		await h.close();
	}
}
process.exit(failed ? 1 : 0);
