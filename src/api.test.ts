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
