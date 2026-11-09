import { beforeAll, describe, expect, it } from "vitest";
import { InkApi, type LiveStroke } from "./api";

beforeAll(() => {
	(globalThis as unknown as { window: unknown }).window ??= globalThis;
});

function fakePlugin(strokeIds: string[] = []) {
	const drawn: { file: string; n: number }[] = [];
	const doc = { strokes: strokeIds.map((id) => ({ id })) };
	const plugin = {
		store: { peek: (f: string) => (f === "a.ink" ? doc : undefined), flush: async () => {} },
		editors: new Set([{ entry: { path: "a.ink" }, surface: { drawRemote: (g: unknown[]) => drawn.push({ file: "a.ink", n: g.length }) } }]),
	};
	return { plugin, drawn, doc };
}

const stroke = (id: string, n = 3): LiveStroke => ({ id, tool: "pen", color: 0, size: 2, points: Array.from({ length: n * 3 }, (_, i) => i) });

describe("InkApi", () => {
	it("verteilt eigene Live-Striche an Zuhörer", () => {
		const { plugin } = fakePlugin();
		const api = new InkApi(plugin as never);
		const got: (string | null)[] = [];
		const off = api.onLiveStroke((f, s) => got.push(s ? `${f}:${s.id}` : null));
		api.emitLive("a.ink", stroke("x"));
		api.emitLive("a.ink", null);
		off();
		api.emitLive("a.ink", stroke("y"));
		expect(got).toEqual(["a.ink:x", null]);
	});

	it("Geist bleibt nach dem Ende stehen, bis der Strich im Dokument ist", () => {
		const { plugin, drawn, doc } = fakePlugin();
		const api = new InkApi(plugin as never);
		api.setRemoteStroke("a.ink", "bob", stroke("s1"), { name: "Bob", color: "#00f" });
		expect(api.ghostsFor("a.ink")).toHaveLength(1);
		api.setRemoteStroke("a.ink", "bob", null);
		expect(api.ghostsFor("a.ink")).toHaveLength(1);
		doc.strokes.push({ id: "s1" });
		api.docChanged("a.ink");
		expect(api.ghostsFor("a.ink")).toHaveLength(0);
		expect(drawn.at(-1)).toEqual({ file: "a.ink", n: 0 });
		api.destroy();
	});

	it("Geister mehrerer Personen und Aufräumen beim Abmelden", () => {
		const { plugin } = fakePlugin();
		const api = new InkApi(plugin as never);
		api.setRemoteStroke("a.ink", "bob", stroke("s1"), { name: "Bob", color: "#00f" });
		api.setRemoteStroke("a.ink", "eve", stroke("s2"), { name: "Eve", color: "#f00" });
		expect(api.ghostsFor("a.ink").map((g) => g.label.name).sort()).toEqual(["Bob", "Eve"]);
		api.clearRemote("bob");
		expect(api.ghostsFor("a.ink").map((g) => g.key)).toEqual(["eve"]);
		api.destroy();
	});
});

describe("InkApi – Zeiger", () => {
	it("zeigt fremde Zeiger und räumt sie beim Abmelden auf", () => {
		const { plugin } = fakePlugin();
		const api = new InkApi(plugin as never);
		const got: unknown[] = [];
		api.onPointer((f, p) => got.push(p && `${f}:${p.kind}`));
		api.emitPointer("a.ink", { x: 1, y: 2, kind: "pen" });
		api.emitPointer("a.ink", null);
		expect(got).toEqual(["a.ink:pen", null]);
		api.setRemotePointer("a.ink", "bob", { x: 10, y: 20, kind: "pen" }, { name: "Bob", color: "#00f" });
		expect(api.pointersFor("a.ink")).toHaveLength(1);
		api.setRemotePointer("a.ink", "bob", { x: 11, y: 21, kind: "pen", down: true });
		expect(api.pointersFor("a.ink")[0].label.name).toBe("Bob");
		api.clearRemote("bob");
		expect(api.pointersFor("a.ink")).toHaveLength(0);
		api.destroy();
	});

	it("Blame wird an offene Flächen der Datei weitergereicht und lässt sich wieder ausschalten", () => {
		const got: unknown[] = [];
		const plugin = {
			store: { peek: () => undefined, flush: async () => {} },
			editors: new Set([
				{ entry: { path: "a.ink" }, surface: { setBlame: (b: unknown) => got.push(b) } },
				{ entry: { path: "b.ink" }, surface: { setBlame: () => got.push("falsch") } },
			]),
		};
		const api = new InkApi(plugin as never);
		const blame = { authors: [{ key: "bob", name: "Bob", color: "#00f" }], strokes: { s1: [0, 1] as [number, number] } };
		api.setBlame("a.ink", blame);
		expect(api.blameFor("a.ink")).toBe(blame);
		api.setBlame("a.ink", null);
		api.setBlame("a.ink", null); // zweites Ausschalten: nichts mehr zu tun
		expect(got).toEqual([blame, null]);
		expect(api.blameFor("a.ink")).toBeNull();
	});
});
