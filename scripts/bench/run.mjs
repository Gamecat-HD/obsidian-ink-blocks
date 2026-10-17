// Bündelt scripts/bench/decoder.ts mit esbuild und führt es aus (Argumente werden durchgereicht).
import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const out = join(mkdtempSync(join(tmpdir(), "ink-bench-")), "decoder.mjs");
await build({ entryPoints: ["scripts/bench/decoder.ts"], bundle: true, platform: "node", format: "esm", outfile: out, logLevel: "warning" });
const r = spawnSync(process.execPath, ["--max-old-space-size=4096", out, ...process.argv.slice(2)], { stdio: "inherit" });
process.exit(r.status ?? 1);
