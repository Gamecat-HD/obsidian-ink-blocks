/**
 * Decoder-Messung auf echter Handschrift: vorberechnete v2-Logits der ScaDS-Val/Test-Zeilen
 * (scripts/bench/dump_logits.py), Greedy gegen Beam-Search mit verschiedenen Sprachmodellen.
 * α/β werden auf Val gewählt und auf Test berichtet.
 *
 *   npm run bench:decoder -- <logits-dir> <vault-dir> [scads-manifest.json]
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { ctcBeamSearch } from "../../src/ocr/beam";
import { ctcGreedy } from "../../src/ocr/ctc";
import { markdownToCorpus } from "../../src/ocr/corpus";
import { buildCharLm, type CharLmData } from "../../src/ocr/lm";
import { editDistance } from "../../src/ocr/benchmark";

interface Line {
	id: string;
	text: string;
	data: Float32Array;
	dims: number[];
}

const [logitsDir, vaultDir, manifestPath] = process.argv.slice(2);
const config = JSON.parse(readFileSync(join(process.cwd(), "models/de-htr-web-v2/config.json"), "utf8"));
const alphabet: string = config.alphabet;

function load(split: string): Line[] {
	const index = JSON.parse(readFileSync(join(logitsDir, `${split}.json`), "utf8"));
	const buf = readFileSync(join(logitsDir, `${split}.bin`));
	const all = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
	return index.map((e: { id: string; text: string; offset: number; T: number; C: number }) => ({
		id: e.id,
		text: e.text,
		data: all.subarray(e.offset, e.offset + e.T * e.C),
		dims: [1, e.T, e.C],
	}));
}

function vaultLines(dir: string): string[] {
	const out: string[] = [];
	const walk = (d: string) => {
		for (const name of readdirSync(d)) {
			if (name.startsWith(".")) continue;
			const p = join(d, name);
			if (statSync(p).isDirectory()) walk(p);
			else if (name.endsWith(".md")) out.push(...markdownToCorpus(readFileSync(p, "utf8")));
		}
	};
	walk(dir);
	return out;
}

const norm = (s: string) => s.replace(/\s+/g, " ").trim();
function score(lines: Line[], decode: (l: Line) => string) {
	let cd = 0, cl = 0, wd = 0, wl = 0;
	const t0 = performance.now();
	for (const l of lines) {
		const ref = norm(l.text);
		const hyp = norm(decode(l));
		cd += editDistance(ref, hyp);
		cl += Array.from(ref).length;
		const rw = ref.split(" "), hw = hyp.split(" ");
		// Wort-Editierdistanz über Codepoint-Abbildung der Wörter
		const vocab = new Map<string, string>();
		const enc = (ws: string[]) => ws.map((w) => vocab.get(w) ?? (vocab.set(w, String.fromCodePoint(0xe000 + vocab.size)), vocab.get(w)!)).join("");
		wd += editDistance(enc(rw), enc(hw));
		wl += rw.length;
	}
	return { cer: cd / cl, wer: wd / wl, ms: (performance.now() - t0) / lines.length };
}

const fmt = (r: { cer: number; wer: number; ms: number }) =>
	`CER ${(r.cer * 100).toFixed(2)} %  WER ${(r.wer * 100).toFixed(1)} %  ${r.ms.toFixed(1)} ms/Zeile`;

const val = load("val");
const test = load("test");
console.log(`Val ${val.length}, Test ${test.length} Zeilen`);
const greedy = (l: Line) => ctcGreedy(l.data, l.dims, alphabet).text;
console.log(`greedy            val ${fmt(score(val, greedy))}`);
console.log(`greedy            test ${fmt(score(test, greedy))}`);
const noLm = (l: Line) => ctcBeamSearch(l.data, l.dims, alphabet, { lm: null, beta: 0, grammar: false }).text;
console.log(`beam ohne LM      test ${fmt(score(test, noLm))}`);

const corpora: Record<string, string[]> = {};
const vault = vaultLines(vaultDir);
corpora.vault = vault;
if (manifestPath) {
	const m = JSON.parse(readFileSync(manifestPath, "utf8"));
	const train = m.lines.train.map((l: { text: string }) => l.text);
	corpora["scads-train"] = train;
	corpora["vault+scads-train"] = [...vault, ...train];
}

for (const [name, lines] of Object.entries(corpora)) {
	const chars = lines.reduce((n, l) => n + l.length, 0);
	for (const order of [5, 6, 7]) {
		const t0 = performance.now();
		const lm: CharLmData = buildCharLm(lines, alphabet, { order });
		const buildMs = performance.now() - t0;
		let best = { alpha: 0, beta: 0, cer: Infinity };
		for (const alpha of [0.2, 0.35, 0.5, 0.7]) {
			for (const beta of [0, 0.5, 1, 1.5, 2.5]) {
				const r = score(val, (l) => ctcBeamSearch(l.data, l.dims, alphabet, { lm, alpha, beta }).text);
				if (r.cer < best.cer) best = { alpha, beta, cer: r.cer };
			}
		}
		const r = score(test, (l) => ctcBeamSearch(l.data, l.dims, alphabet, { lm, alpha: best.alpha, beta: best.beta }).text);
		console.log(
			`LM ${name} (${(chars / 1e6).toFixed(2)} M Zeichen, Ordnung ${order}, ${lm.counts.size} n-Gramme, ${buildMs.toFixed(0)} ms) ` +
				`α=${best.alpha} β=${best.beta}  test ${fmt(r)}`,
		);
	}
}
