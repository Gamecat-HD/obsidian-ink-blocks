// M7: OCR-Messung – Notiz mit 30 Testsätzen anlegen, zwei davon "schreiben", auswerten → Bericht mit CER.
import assert from "node:assert/strict";
import { textToStrokes } from "../lib/hershey.mjs";

export default async (h) => {
	h.evalTimeout = 120000;
	await h.evaluate(() => app.commands.executeCommandById("obsidian-ink-blocks:benchmark-create"));
	await h.waitFor(() => h.evaluate(() => /OCR-Messung/.test(app.workspace.activeEditor?.file?.path ?? "")), { what: "Messnotiz" });
	await h.evaluate(async () => {
		const leaf = app.workspace.getMostRecentLeaf();
		await leaf.setViewState({ ...leaf.getViewState(), state: { ...leaf.getViewState().state, mode: "source", source: false } });
	});
	await h.sleep(1000);
	const info = await h.evaluate(() => ({
		prompts: (app.workspace.activeEditor.editor.getValue().match(/^\*\*\d+\.\*\*/gm) ?? []).length,
		inkFiles: app.vault.getFiles().filter((f) => f.extension === "ink" && f.path.includes("ocr-messung")).length,
	}));
	assert.deepEqual(info, { prompts: 30, inkFiles: 30 });

	// Satz 5 und 26 in ihre Flächen schreiben
	for (const [n, text] of [[5, "Subnetzmaske 255.255.255.0"], [26, "HTTP nutzt Port 80, HTTPS Port 443."]]) {
		// CodeMirror rendert Blöcke erst im sichtbaren Bereich → hinscrollen, bis die Fläche da ist.
		const r = await h.waitFor(
			() =>
				h.evaluate((n) => {
					const ed = app.workspace.activeEditor.editor;
					const v = ed.getValue();
					const line = v.split("\n").findIndex((l) => l.startsWith(`**${n}.**`));
					const path = /```ink\nfile: (\S+)/.exec(v.slice(v.indexOf(`**${n}.**`)))?.[1];
					const el = document.querySelector(`.markdown-source-view .ink-surface[data-path="${path}"]`);
					if (!el) {
						ed.scrollIntoView({ from: { line, ch: 0 }, to: { line: line + 5, ch: 0 } }, true);
						return null;
					}
					const b = el.getBoundingClientRect();
					if (b.top < 60 || b.bottom > window.innerHeight - 40) {
						el.scrollIntoView({ block: "center" });
						return null;
					}
					return { x: b.x + el.clientLeft, y: b.y + el.clientTop, w: el.clientWidth };
				}, n),
			{ timeout: 10000, interval: 300, what: `Fläche zu Satz ${n}` },
		);
		assert.ok(r, `Fläche zu Satz ${n} nicht gefunden`);
		const k = r.w / 1000;
		for (const pts of textToStrokes(text, { font: "EMSReadability", size: 50, y: 80, x: 30 })) {
			const path = [];
			for (let i = 0; i < pts.length; i += 3) path.push([r.x + pts[i] * k, r.y + pts[i + 1] * k, pts[i + 2]]);
			await h.draw(path, { step: 0 });
		}
	}

	await h.evaluate(() => app.commands.executeCommandById("obsidian-ink-blocks:benchmark-evaluate"));
	const report = await h.waitFor(
		() => h.evaluate(() => { const v = app.workspace.activeEditor.editor.getValue(); const i = v.indexOf("## Ergebnis"); return i >= 0 ? v.slice(i) : null; }),
		{ timeout: 90000, what: "Bericht" },
	);
	console.log(report.split("\n").filter((l) => /Gesamt|^\| (5|26) /.test(l)).map((l) => `  ${l}`).join("\n"));
	assert.match(report, /2\/30 Zeilen geschrieben/);
	assert.match(report, /Engine: `htr-v2@/);
	const total = Number(/Gesamt-CER: ([\d,]+) %/.exec(report)[1].replace(",", "."));
	assert.ok(total < 30, `Gesamt-CER ${total} %`);
	assert.match(report, /\| 1 \| Die Übung beginnt um acht Uhr\. \| – \| – \|/);
	await h.screenshot("m7-benchmark.png");
};
