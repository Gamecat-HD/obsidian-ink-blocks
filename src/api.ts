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

export interface RemoteLabel {
	name: string;
	/** CSS-Farbe der Person (Namensschild) */
	color: string;
}

type LiveListener = (file: string, stroke: LiveStroke | null) => void;
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
	/** Datei → Schlüssel (z. B. Person) → Geist */
	private ghosts = new Map<string, Map<string, Ghost>>();
	private sweepTimer = 0;

	constructor(private readonly plugin: InkBlocksPlugin) {}

	/** Eigene Striche während des Zeichnens (`null` = Strich beendet oder abgebrochen). */
	onLiveStroke(fn: LiveListener): () => void {
		this.live.add(fn);
		return () => this.live.delete(fn);
	}

	/** Nach jeder abgeschlossenen Änderung an einer Fläche (Strich, Radieren, Lasso, Undo …). */
	onCommit(fn: CommitListener): () => void {
		this.commits.add(fn);
		return () => this.commits.delete(fn);
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

	/** Alle Geister einer Person entfernen (z. B. offline gegangen). */
	clearRemote(key: string) {
		for (const [file, byKey] of this.ghosts) {
			if (byKey.delete(key)) this.render(file);
		}
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
		for (const ed of this.plugin.editors) if (ed.entry.path === file) ed.surface.drawRemote(ghosts);
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
