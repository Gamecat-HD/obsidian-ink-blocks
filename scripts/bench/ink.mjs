// Bündelt scripts/bench/ink.ts mit esbuild und führt es aus.
import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const out = join(mkdtempSync(join(tmpdir(), "ink-bench-")), "ink.mjs");
await build({ entryPoints: ["scripts/bench/ink.ts"], bundle: true, platform: "node", format: "esm", outfile: out, logLevel: "warning" });
const r = spawnSync(process.execPath, [out, ...process.argv.slice(2)], { stdio: "inherit" });
process.exit(r.status ?? 1);
