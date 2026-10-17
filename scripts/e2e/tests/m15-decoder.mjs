// M15: Beam-Search mit Vault-Sprachmodell – dieselben Striche einmal greedy, einmal mit LM erkennen und die
// Zeichenfehlerrate vergleichen. Das LM kommt aus einer Fachnotiz im Test-Vault (andere Sätze als die Vorgaben).
import assert from "node:assert/strict";
import { textToStrokes } from "../lib/hershey.mjs";
const ID = "obsidian-ink-blocks";

const PROMPTS = [
	"Die Subnetzmaske ist 255.255.255.0",
	"IPv6-Adresse: 2001:db8::1",
	"Der Router leitet Pakete weiter.",
	"Schicht 3 ist die Vermittlungsschicht.",
	"Link-Local beginnt mit fe80::",
	"Ein Switch arbeitet auf Schicht 2.",
];
const NOTE = [
	"# Netzwerktechnik",
	"",
	"Im OSI-Modell ist die Vermittlungsschicht die dritte Schicht. Router arbeiten auf der Vermittlungsschicht,",
	"ein Switch arbeitet auf der Sicherungsschicht. Pakete werden vom Router anhand der Zieladresse weitergeleitet.",
	"Eine Subnetzmaske wie 255.255.0.0 trennt Netzanteil und Hostanteil. Die Adresse 2001:db8:: ist für Dokumentation reserviert.",
	"Link-Local-Adressen beginnen mit fe80, die Loopback-Adresse ist ::1. Die Pakete gehen über das Netz.",
].join("\n");

function editDistance(a, b) {
	const x = [...a], y = [...b];
	let prev = Array.from({ length: y.length + 1 }, (_, j) => j);
	for (let i = 1; i <= x.length; i++) {
		const cur = [i];
		for (let j = 1; j <= y.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
		prev = cur;
	}
	return prev[y.length];
}
const cer = (refs, hyps) => refs.reduce((n, r, i) => n + editDistance(r, hyps[i] ?? ""), 0) / refs.reduce((n, r) => n + r.length, 0);

export default async (h) => {
	h.evalTimeout = 120000;
	await h.evaluate(async (note) => {
		await app.vault.create("Netzwerktechnik.md", note);
	}, NOTE);
	await h.evaluate((id) => { app.plugins.plugins[id].settings.ocrEnabled = false; }, ID);
	await h.evaluate(async () => {
		await app.workspace.getLeaf().openFile(app.vault.getFileByPath("Notiz.md"), { state: { mode: "source", source: false } });
		app.workspace.activeEditor.editor.setCursor({ line: 3, ch: 0 });
		app.commands.executeCommandById("obsidian-ink-blocks:insert-notebook");
	});
	await h.sleep(800);

	const rect = () =>
		h.evaluate(() => {
			const el = document.querySelector(".markdown-source-view .ink-surface");
			const r = el.getBoundingClientRect();
			return { x: r.x + el.clientLeft, y: r.y + el.clientTop, w: el.clientWidth };
		});
	for (const [i, text] of PROMPTS.entries()) {
		const r = await rect();
		const k = r.w / 1000;
		const font = i % 2 ? "EMSAllure" : "EMSReadability";
		for (const pts of textToStrokes(text, { font, size: 46, y: 70 + i * 80, seed: i + 1 })) {
			const path = [];
			for (let j = 0; j < pts.length; j += 3) path.push([r.x + pts[j] * k, r.y + pts[j + 1] * k, pts[j + 2]]);
			await h.draw(path, { step: 0 });
		}
	}
	await h.sleep(500);

	const recognize = async (lm) => {
		await h.evaluate((id, lm) => {
			const p = app.plugins.plugins[id];
			p.settings.ocrLanguageModel = lm;
			p.ocr.reset();
			app.workspace.activeEditor.editor.setCursor({ line: 0, ch: 0 });
			app.commands.executeCommandById("obsidian-ink-blocks:recognize-note");
		}, ID, lm);
		const engine = lm ? /\+lm$/ : /^htr-v2@[0-9a-f]{8}$/;
		const state = () =>
			h.evaluate((id) => {
				const entry = [...app.plugins.plugins[id].store.entries.values()].find((e) => e.doc?.ocr);
				const m = /```ink\n[\s\S]*?text: \|\n((?:  .*\n?)+)/.exec(app.workspace.activeEditor.editor.getValue());
				return { engine: entry?.doc.ocr.engine ?? "", text: m ? m[1].split("\n").map((l) => l.replace(/^  /, "")).filter(Boolean) : [] };
			}, ID);
		const done = await h.waitFor(
			async () => {
				const v = await state();
				return v.text.length === PROMPTS.length && engine.test(v.engine) ? v : null;
			},
			{ timeout: 60000, what: `Erkennung (LM ${lm})` },
		);
		return done.text;
	};

	const greedy = await recognize(false);
	const withLm = await recognize(true);
	PROMPTS.forEach((p, i) => console.log(`  ${JSON.stringify(p)}\n    greedy ${JSON.stringify(greedy[i])}\n    LM     ${JSON.stringify(withLm[i])}`));
	const a = cer(PROMPTS, greedy), b = cer(PROMPTS, withLm);
	console.log(`  CER greedy ${(a * 100).toFixed(1)} % → LM ${(b * 100).toFixed(1)} %`);
	assert.ok(b <= a, `LM schlechter als greedy: ${b} > ${a}`);
	await h.screenshot("m15-decoder.png");
};
