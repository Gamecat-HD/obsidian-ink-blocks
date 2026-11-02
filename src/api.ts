/**
 * Öffentliche, optionale Schnittstelle für andere Plugins (z. B. Tandem: Echtzeit-Zusammenarbeit).
 * Zugriff: `app.plugins.plugins["obsidian-ink-blocks"].api` – `version` prüfen.
 *
 * - Eigene Striche während des Zeichnens beobachten (`onLiveStroke`) → an andere senden.
 * - Fremde, gerade entstehende Striche als halbtransparente „Geister“ mit Namen anzeigen (`setRemoteStroke`).
 *   Endet ein fremder Strich, bleibt sein Geist stehen, bis der fertige Strich (gleiche ID) im Dokument ist.
 * - Nach jeder abgeschlossenen Änderung sofort speichern lassen (`onCommit` + `flush`), statt auf die
 *   Speicherverzögerung zu warten.
 * Ohne Nutzer dieser Schnittstelle ändert sich am Verhalten von Ink Blocks nichts.
 */
import type InkBlocksPlugin from "./main";
import type { InkColor, Tool } from "./model/ink-format";

export interface LiveStroke {
	/** Wird zur ID des fertigen Strichs. */
	id: string;
	tool: Tool;
	color: InkColor;
	size: number;
	/** [x, y, p, …] in Doc-Einheiten */
	points: number[];
	simulated?: boolean;
}

/** Position von Stift/Maus über einer Fläche (Doc-Einheiten). */
export interface PointerPos {
	x: number;
	y: number;
	kind: "pen" | "mouse" | "touch";
	/** Zeichnet gerade (Stift/Maus unten) */
	down?: boolean;
}

export interface RemoteLabel {
	name: string;
	/** CSS-Farbe der Person (Namensschild) */
	color: string;
}

type LiveListener = (file: string, stroke: LiveStroke | null) => void;
type PointerListener = (file: string, pos: PointerPos | null) => void;
type CommitListener = (file: string) => void;

interface Ghost {
	stroke: LiveStroke;
	label: RemoteLabel;
	/** Strich ist beim Absender fertig: Geist verschwindet, sobald der Strich da ist (spätestens nach Ablauf). */
	endedAt: number | null;
}

/** So lange bleibt ein beendeter Geist höchstens stehen, falls der fertige Strich nie ankommt. */
export const GHOST_TTL = 6000;

export class InkApi {
	readonly version = 1;
	private live = new Set<LiveListener>();
	private commits = new Set<CommitListener>();
	private pointerListeners = new Set<PointerListener>();
	/** Datei → Schlüssel → fremder Zeiger */
	private pointers = new Map<string, Map<string, { pos: PointerPos; label: RemoteLabel }>>();
	/** Datei → Schlüssel (z. B. Person) → Geist */
	private ghosts = new Map<string, Map<string, Ghost>>();
	private sweepTimer = 0;

	constructor(private readonly plugin: InkBlocksPlugin) {}

	/** Eigene Striche während des Zeichnens (`null` = Strich beendet oder abgebrochen). */
	onLiveStroke(fn: LiveListener): () => void {
		this.live.add(fn);
		return () => this.live.delete(fn);
	}

	/** Eigene Stift-/Mausposition über einer Fläche (`null` = Fläche verlassen). Feuert bei jeder Bewegung – selbst drosseln. */
	onPointer(fn: PointerListener): () => void {
		this.pointerListeners.add(fn);
		return () => this.pointerListeners.delete(fn);
	}

	/** Fremden Zeiger (Stift/Maus) mit Namen zeigen; `null` = entfernen. */
	setRemotePointer(file: string, key: string, pos: PointerPos | null, label?: RemoteLabel) {
		let byKey = this.pointers.get(file);
		if (pos) {
			if (!byKey) this.pointers.set(file, (byKey = new Map()));
			byKey.set(key, { pos, label: label ?? byKey.get(key)?.label ?? { name: "", color: "#888" } });
		} else {
			if (!byKey?.delete(key)) return;
			if (!byKey.size) this.pointers.delete(file);
		}
		this.render(file);
	}

	pointersFor(file: string): { key: string; pos: PointerPos; label: RemoteLabel }[] {
		return [...(this.pointers.get(file) ?? [])].map(([key, p]) => ({ key, pos: p.pos, label: p.label }));
	}

	emitPointer(file: string, pos: PointerPos | null) {
		for (const fn of this.pointerListeners) {
			try {
				fn(file, pos);
			} catch (e) {
				console.warn("[ink-blocks] api.onPointer", e);
			}
		}
	}

	/** Nach jeder abgeschlossenen Änderung an einer Fläche (Strich, Radieren, Lasso, Undo …). */
	onCommit(fn: CommitListener): () => void {
		this.commits.add(fn);
		return () => this.commits.delete(fn);
	}

	/**
	 * `fn` exklusiv für diese .ink-Datei ausführen: Ink Blocks liest/speichert währenddessen nicht.
	 * Wer die Datei von außen schreibt (z. B. Tandem per `vault.process`), sollte das hierin tun –
	 * `vault.process` allein ist nicht atomar gegenüber gleichzeitigem Speichern.
	 */
	exclusive<T>(file: string, fn: () => Promise<T> | T): Promise<T> {
		return this.plugin.store.exclusive(file, fn);
	}

	/** Ausstehende Änderungen dieser .ink-Datei sofort speichern. */
	async flush(file: string): Promise<void> {
		await this.plugin.store.flush(file);
	}

	/** Pfade der .ink-Dateien, die gerade in einer Zeichenansicht offen sind. */
	openFiles(): string[] {
		return [...new Set([...this.plugin.editors].map((e) => e.entry.path))];
	}

	/** Fremden Strich zeigen/aktualisieren; `null` = beim Absender beendet. */
	setRemoteStroke(file: string, key: string, stroke: LiveStroke | null, label?: RemoteLabel) {
		let byKey = this.ghosts.get(file);
		if (stroke) {
			if (!byKey) this.ghosts.set(file, (byKey = new Map()));
			byKey.set(key, { stroke, label: label ?? byKey.get(key)?.label ?? { name: "", color: "#888" }, endedAt: null });
		} else {
			const g = byKey?.get(key);
			if (!g) return;
			g.endedAt = Date.now();
		}
		this.prune(file);
		this.render(file);
		this.scheduleSweep();
	}

	/** Alle Geister und Zeiger einer Person entfernen (z. B. offline gegangen). */
	clearRemote(key: string) {
		const files = new Set<string>();
		for (const [file, byKey] of this.ghosts) if (byKey.delete(key)) files.add(file);
		for (const [file, byKey] of this.pointers) {
			if (byKey.delete(key)) files.add(file);
			if (!byKey.size) this.pointers.delete(file);
		}
		for (const f of files) this.render(f);
	}

	// ── intern (von Ink Blocks selbst aufgerufen) ──────────────────────

	emitLive(file: string, stroke: LiveStroke | null) {
		for (const fn of this.live) {
			try {
				fn(file, stroke);
			} catch (e) {
				console.warn("[ink-blocks] api.onLiveStroke", e);
			}
		}
	}

	emitCommit(file: string) {
		for (const fn of this.commits) {
			try {
				fn(file);
			} catch (e) {
				console.warn("[ink-blocks] api.onCommit", e);
			}
		}
	}

	/** Dokument einer Datei hat sich geändert (z. B. Sync): angekommene Striche ersetzen ihre Geister. */
	docChanged(file: string) {
		if (this.prune(file)) this.render(file);
	}

	ghostsFor(file: string): { key: string; stroke: LiveStroke; label: RemoteLabel }[] {
		return [...(this.ghosts.get(file) ?? [])].map(([key, g]) => ({ key, stroke: g.stroke, label: g.label }));
	}

	destroy() {
		window.clearTimeout(this.sweepTimer);
		this.ghosts.clear();
		this.pointers.clear();
		this.pointerListeners.clear();
		this.live.clear();
		this.commits.clear();
	}

	/** Beendete Geister entfernen, deren Strich im Dokument ist (oder die abgelaufen sind). */
	private prune(file: string): boolean {
		const byKey = this.ghosts.get(file);
		if (!byKey) return false;
		const doc = this.plugin.store.peek(file);
		const ids = doc ? new Set(doc.strokes.map((s) => s.id)) : new Set<string>();
		let changed = false;
		for (const [key, g] of byKey) {
			const arrived = ids.has(g.stroke.id);
			const expired = g.endedAt !== null && Date.now() - g.endedAt > GHOST_TTL;
			if ((g.endedAt !== null && arrived) || expired) {
				byKey.delete(key);
				changed = true;
			}
		}
		if (!byKey.size) this.ghosts.delete(file);
		return changed;
	}

	private render(file: string) {
		const ghosts = this.ghostsFor(file);
		const pointers = this.pointersFor(file);
		for (const ed of this.plugin.editors) if (ed.entry.path === file) ed.surface.drawRemote(ghosts, pointers);
	}

	private scheduleSweep() {
		window.clearTimeout(this.sweepTimer);
		const pending = [...this.ghosts.values()].some((m) => [...m.values()].some((g) => g.endedAt !== null));
		if (!pending) return;
		this.sweepTimer = window.setTimeout(() => {
			for (const file of [...this.ghosts.keys()]) if (this.prune(file)) this.render(file);
			this.scheduleSweep();
		}, 1000);
	}
}
