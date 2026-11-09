import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => {
	class TAbstractFile {
		constructor(public path: string) {}
	}
	class TFile extends TAbstractFile {
		get extension() {
			return this.path.split(".").pop() ?? "";
		}
	}
	class TFolder extends TAbstractFile {}
	/** Wie Obsidians debounce: Aufruf merkt vor, `run()` führt Ausstehendes sofort aus. */
	function debounce(fn: () => unknown) {
		let pending = false;
		const d = Object.assign(() => ((pending = true), d), {
			run: () => {
				if (!pending) return undefined;
				pending = false;
				return fn();
			},
			cancel: () => {
				pending = false;
				return d;
			},
		});
		return d;
	}
	return { TAbstractFile, TFile, TFolder, debounce, normalizePath: (p: string) => p, Platform: { isMobile: false } };
});

import { TFile } from "obsidian";
import { createNotebook, decodeInk, encodeInk, type InkData, type Stroke } from "../model/ink-format";
import { InkStore } from "./InkStore";

beforeAll(() => {
	(globalThis as unknown as { window: unknown }).window ??= globalThis;
});

const stroke = (id: string, y = 10): Stroke => ({ id, tool: "pen", color: 0, size: 3, points: [1.234, y + 0.111, 0.5, 5.678, y + 3.333, 0.7] });

/** Vault im Speicher: lesen, `process`, fremdes Schreiben (löst `modify` aus). */
function fakeVault(initial: InkData) {
	const files = new Map<string, string>([["a.ink", encodeInk(initial)]]);
	const handlers = new Map<string, ((...a: unknown[]) => void)[]>();
	const file = new (TFile as unknown as new (path: string) => TFile)("a.ink");
	const emit = (ev: string, ...a: unknown[]) => handlers.get(ev)?.forEach((h) => h(...a));
	const vault = {
		on: (ev: string, h: (...a: unknown[]) => void) => (handlers.set(ev, [...(handlers.get(ev) ?? []), h]), { ev }),
		getFileByPath: (p: string) => (files.has(p) ? file : null),
		read: async (f: { path: string }) => files.get(f.path)!,
		process: async (f: { path: string }, fn: (d: string) => string) => {
			const out = fn(files.get(f.path)!);
			files.set(f.path, out);
			emit("modify", f);
			return out;
		},
	};
	const plugin = {
		app: { vault, metadataCache: {} },
		registerEvent: () => {},
		editors: new Set(),
		api: { docChanged: () => {} },
	};
	/** Andere Person/Gerät schreibt die Datei. */
	const external = async (doc: InkData) => {
		files.set("a.ink", encodeInk(doc));
		emit("modify", file);
	};
	return { plugin, files, external, text: () => files.get("a.ink")! };
}

const idle = () => new Promise((r) => setTimeout(r, 0));

describe("InkStore", () => {
	it("eigener Strich nach einer fremden Änderung geht beim nächsten Zusammenführen nicht verloren", async () => {
		const start = createNotebook("x");
		start.strokes = [stroke("a")];
		const { plugin, external, text } = fakeVault(start);
		const store = new InkStore(plugin as never);
		const entry = (await store.acquire("a.ink", () => {}))!;

		// 1. fremde Änderung ohne eigene → Dokument wird ersetzt
		await external({ ...start, strokes: [stroke("a"), stroke("b", 30)] });
		await idle();
		expect(entry.doc.strokes.map((s) => s.id)).toEqual(["a", "b"]);

		// 2. eigener Strich (wie applyOp: push ins Array), noch nicht gespeichert
		entry.doc.strokes.push(stroke("mine", 60));
		store.touch(entry);

		// 3. nächste fremde Änderung kommt vor dem Speichern
		await external({ ...start, strokes: [stroke("a"), stroke("b", 30), stroke("c", 90)] });
		await idle();
		expect(entry.doc.strokes.map((s) => s.id).sort()).toEqual(["a", "b", "c", "mine"]);

		await store.flush("a.ink");
		expect(decodeInk(text()).strokes.map((s) => s.id).sort()).toEqual(["a", "b", "c", "mine"]);
	});

	it("unveränderte Striche behalten nach fremden Änderungen ihr Objekt", async () => {
		const start = createNotebook("x");
		start.strokes = [stroke("a"), stroke("b", 30)];
		const { plugin, external } = fakeVault(start);
		const store = new InkStore(plugin as never);
		const entry = (await store.acquire("a.ink", () => {}))!;
		const [a, b] = entry.doc.strokes;

		// eigener Strich (ungerundete Punkte) wird gespeichert und kommt quantisiert zurück
		const own = stroke("own", 120);
		entry.doc.strokes.push(own);
		store.touch(entry);
		await store.flush("a.ink");

		await external({ ...start, strokes: [stroke("a"), stroke("b", 30), own, stroke("c", 200)] });
		await idle();
		expect(entry.doc.strokes.map((s) => s.id)).toEqual(["a", "b", "own", "c"]);
		expect(entry.doc.strokes[0]).toBe(a);
		expect(entry.doc.strokes[1]).toBe(b);
		expect(entry.doc.strokes[2]).toBe(own);
	});
});
