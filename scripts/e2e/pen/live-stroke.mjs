// Live-Strich mit (virtuellem) echtem Stift: Ist die Tinte auf dem Bildschirm zu sehen, solange der Stift
// noch aufliegt? Öffnet eine isolierte Obsidian als Wayland-Fenster auf einem eigenen Hyprland-Workspace,
// schreibt per uinput-Stift (vpen.py) in eine Schreibfläche und fotografiert den Bildschirm mit grim –
// mitten im Strich und nach dem Absetzen. Zum Vergleich dasselbe im Pen-Diagnose-Dialog.
//
//   node scripts/e2e/pen/live-stroke.mjs [--plugin-from <dir mit main.js/styles.css/manifest.json>] [--vault <Vorlage>] [--label x]
//   --vault: Vault-Vorlage statt test-vault/ (z. B. mit Theme und Plugins des echten Vaults; braucht Notiz.md)
//
// Voraussetzungen: Hyprland, grim, python-evdev, Schreibrecht auf /dev/uinput. Bewegt den Stift-Cursor auf
// dem echten Bildschirm (~30 s), danach geht es zum vorherigen Workspace zurück.
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { launch } from "../harness.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, "../../../e2e-out/pen");
const ID = "obsidian-ink-blocks";
const WORKSPACE = 9;
const arg = (name) => {
	const i = process.argv.indexOf(name);
	return i > 0 ? process.argv[i + 1] : undefined;
};
const label = arg("--label") ?? "current";
const palm = arg("--palm")?.split(",").map(Number);
mkdirSync(OUT, { recursive: true });

const hypr = (...a) => execFileSync("hyprctl", a, { encoding: "utf8" });
const monitor = JSON.parse(hypr("-j", "monitors")).find((m) => m.focused);
const logical = { w: Math.round(monitor.width / monitor.scale), h: Math.round(monitor.height / monitor.scale) };
const prevWs = JSON.parse(hypr("-j", "activeworkspace")).id;

// ---- virtueller Stift ----
const pen = spawn("python3", ["-I", resolve(HERE, "vpen.py"), "--width", logical.w, "--height", logical.h], {
	stdio: ["pipe", "pipe", "inherit"],
});
const lines = createInterface({ input: pen.stdout })[Symbol.asyncIterator]();
const penCmd = async (cmd) => {
	pen.stdin.write(cmd + "\n");
	await lines.next();
};
await lines.next(); // "ready"

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = (name, r) => {
	const file = resolve(OUT, `${label}-${name}.png`);
	execFileSync("grim", ["-g", `${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.w)}x${Math.round(r.h)}`, file]);
	return file;
};
/** Anteil dunkler Pixel (Tinte) im Bild – PIL. */
const inkRatio = (file) =>
	Number(
		execFileSync("python3", ["-I", "-c", `
import sys
from PIL import Image
im = Image.open(sys.argv[1]).convert("RGB")
px = list(im.get_flattened_data()) if hasattr(im, "get_flattened_data") else list(im.getdata())
if px and isinstance(px[0], int): px = list(zip(px[0::3], px[1::3], px[2::3]))
bg = sorted(px, key=sum)[len(px)//2]
print(sum(1 for p in px if sum(abs(a - b) for a, b in zip(p, bg)) > 120) / len(px))
`, file], { encoding: "utf8" }),
	);

hypr("dispatch", `hl.dsp.focus({ workspace = ${WORKSPACE} })`);
let h;
const results = {};
try {
	h = await launch({ ozone: "wayland", pluginFrom: arg("--plugin-from"), vaultTemplate: arg("--vault") });
	await sleep(1500);
	const win = JSON.parse(hypr("-j", "clients")).find((c) => c.workspace.id === WORKSPACE && /obsidian/i.test(c.class));
	if (!win) throw new Error("Test-Fenster nicht auf Workspace " + WORKSPACE);

	await h.evaluate(async (id) => {
		const p = app.plugins.plugins[id];
		if ("shapeRecognition" in p.settings) p.settings.shapeRecognition = false; // Halten soll keine Form erzeugen
		await app.workspace.getLeaf().openFile(app.vault.getFileByPath("Notiz.md"), { state: { mode: "source", source: false } });
		app.workspace.activeEditor.editor.setCursor({ line: 3, ch: 0 });
		app.commands.executeCommandById(`${id}:insert-notebook`);
		// Instrumentierung: Pen-Events und Frames, während der Stift aufliegt.
		window.__pen = { moves: 0, frames: 0, down: false, last: null, types: new Set() };
		const s = window.__pen;
		const tick = () => {
			if (s.down) s.frames++;
			requestAnimationFrame(tick);
		};
		requestAnimationFrame(tick);
		window.addEventListener("pointerdown", (e) => { s.down = true; s.types.add(e.pointerType); }, true);
		window.addEventListener("pointerup", () => (s.down = false), true);
		window.addEventListener("pointermove", (e) => {
			s.last = { x: e.clientX, y: e.clientY, type: e.pointerType };
			if (s.down) s.moves++;
		}, true);
	}, ID);
	await sleep(1000);

	// Kalibrieren: Bildschirm → Seitenkoordinaten (Fensterrahmen, Gaps).
	const probe = { x: win.at[0] + win.size[0] / 2, y: win.at[1] + win.size[1] / 2 };
	await penCmd(`hover ${probe.x} ${probe.y}`);
	await sleep(100);
	await penCmd(`move ${probe.x + 5} ${probe.y + 5} 0`);
	await sleep(200);
	const last = await h.evaluate(() => window.__pen.last);
	if (!last || last.type !== "pen") throw new Error(`Kein Pen-Event angekommen: ${JSON.stringify(last)}`);
	const off = { x: probe.x + 5 - last.x, y: probe.y + 5 - last.y };
	console.log(`Fenster ${win.at} ${win.size}, Offset ${off.x},${off.y}`);
	const toScreen = (r) => ({ x: r.x + off.x, y: r.y + off.y, w: r.w, h: r.h });

	/** Wellenlinie schreiben, in der Mitte anhalten (Stift bleibt unten) und fotografieren. */
	const write = async (name, rect, sampleCanvas) => {
		await h.evaluate(() => Object.assign(window.__pen, { moves: 0, frames: 0 }));
		const s = toScreen(rect);
		const y0 = s.y + Math.min(80, s.h / 2);
		const pt = (t) => [s.x + s.w * (0.1 + 0.6 * t), y0 + 12 * Math.sin(t * 20)];
		const region = { x: s.x, y: y0 - 40, w: s.w, h: 80 };
		const before = inkRatio(shot(`${name}-0-before`, region));
		if (palm) {
			await penCmd(`palm ${pt(0)[0] + palm[0]} ${pt(0)[1] + palm[1]}`);
			await sleep(150);
		}
		await penCmd(`hover ${pt(0)[0]} ${pt(0)[1]}`);
		await sleep(50);
		await penCmd(`down ${pt(0)[0]} ${pt(0)[1]} 0.3`);
		const N = 80;
		for (let i = 1; i <= N; i++) {
			const [x, y] = pt(i / N);
			await penCmd(`move ${x} ${y} ${0.3 + 0.4 * Math.sin((i / N) * Math.PI)}`);
			if (palm && i % 8 === 0) await penCmd(`palm ${x + palm[0]} ${y0 + palm[1]}`);
			await sleep(5);
		}
		await sleep(400); // Stift liegt noch auf
		const during = inkRatio(shot(`${name}-1-during`, region));
		const stats = await h.evaluate(() => ({ moves: window.__pen.moves, frames: window.__pen.frames, down: window.__pen.down }));
		const canvasInk = sampleCanvas ? await h.evaluate(sampleCanvas) : null;
		await penCmd("up");
		await penCmd("out");
		if (palm) await penCmd("palmup");
		await sleep(500);
		const after = inkRatio(shot(`${name}-2-after`, region));
		return { before, during, after, ...stats, canvasInk };
	};

	// 1. Schreibfläche in Live Preview
	const block = await h.evaluate(() => {
		const el = document.querySelector(".markdown-source-view .ink-surface");
		el.scrollIntoView({ block: "center" });
		const r = el.getBoundingClientRect();
		return { x: r.x, y: r.y, w: r.width, h: r.height };
	});
	await sleep(300);
	const blockRect = await h.evaluate(() => {
		const r = document.querySelector(".markdown-source-view .ink-surface").getBoundingClientRect();
		return { x: r.x, y: r.y, w: r.width, h: r.height };
	});
	results.block = await write("block", blockRect ?? block, () => {
		// Hat irgendeine Kachel (Live-Canvas in alten Versionen) Tinte?
		let n = 0;
		for (const c of document.querySelectorAll(".markdown-source-view .ink-surface canvas")) {
			if (!c.width || !c.height || getComputedStyle(c).display === "none") continue;
			const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
			for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
		}
		return n;
	});
	results.block.strokesSaved = await h.evaluate((id) => {
		const el = document.querySelector(".markdown-source-view .ink-surface");
		return app.plugins.plugins[id].store.entries.get(el.dataset.path)?.doc.strokes.length;
	}, ID);

	// 2. Pen-Diagnose-Dialog (Referenz)
	await h.evaluate((id) => app.commands.executeCommandById(`${id}:pen-diagnostics`), ID);
	await sleep(800);
	const diag = await h.evaluate(() => {
		const r = document.querySelector(".ink-diagnostics-canvas").getBoundingClientRect();
		return { x: r.x, y: r.y, w: r.width, h: r.height };
	});
	results.diagnostics = await write("diag", diag);
} finally {
	try {
		pen.stdin.write("quit\n");
	} catch {}
	await h?.close();
	hypr("dispatch", `hl.dsp.focus({ workspace = ${prevWs} })`);
}

console.log(JSON.stringify({ label, ...results }, null, 2));
console.log(`Screenshots: ${OUT}/${label}-*.png`);
