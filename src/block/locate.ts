import { parseBlock } from "./source";

/** Zeilenbereich eines ```ink-Blocks in einer Notiz (0-basierte Zeilen). */
export interface InkFence {
	/** Zeile des öffnenden Fence */
	open: number;
	/** Zeile des schließenden Fence */
	close: number;
	file?: string;
	body: string;
}

const OPEN = /^(\s{0,3})(`{3,}|~{3,})\s*ink\s*$/;

export function findInkFences(noteText: string): InkFence[] {
	const lines = noteText.split(/\r?\n/);
	const fences: InkFence[] = [];
	let inOther: string | null = null;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (inOther) {
			if (line.trim().startsWith(inOther) && /^[`~]+$/.test(line.trim())) inOther = null;
			continue;
		}
		const m = OPEN.exec(line);
		if (!m) {
			const other = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
			if (other) inOther = other[1];
			continue;
		}
		const marker = m[2];
		let close = -1;
		for (let j = i + 1; j < lines.length; j++) {
			const t = lines[j].trim();
			if (t.length >= marker.length && t[0] === marker[0] && /^([`~])\1*$/.test(t)) {
				close = j;
				break;
			}
		}
		if (close < 0) break; // nicht geschlossen → Rest ist Code, kein gültiger Block
		const body = lines.slice(i + 1, close).join("\n");
		fences.push({ open: i, close, file: parseBlock(body).file, body });
		i = close;
	}
	return fences;
}

/**
 * Findet den Block zu `inkPath`. Bei mehreren Treffern (kopierter Block) gewinnt der nächste zu `hintLine`.
 * `duplicates` > 0 signalisiert, dass mehrere Blöcke auf dieselbe Datei zeigen.
 */
export function locateInkFence(
	noteText: string,
	inkPath: string,
	hintLine?: number,
): { fence: InkFence; duplicates: number } | null {
	const matches = findInkFences(noteText).filter((f) => f.file === inkPath);
	if (!matches.length) return null;
	const hint = hintLine ?? 0;
	matches.sort((a, b) => Math.abs(a.open - hint) - Math.abs(b.open - hint));
	return { fence: matches[0], duplicates: matches.length - 1 };
}

/**
 * Zeilen (0-basiert, inklusive), die beim Löschen des Blocks wegfallen: der Block selbst und – wenn er
 * zwischen Leerzeilen bzw. am Notizanfang/-ende steht – eine angrenzende Leerzeile, damit keine doppelte bleibt.
 */
export function fenceRemovalLines(lines: string[], fence: InkFence): { from: number; to: number } {
	const blank = (n: number) => lines[n].trim() === "";
	const hasBefore = fence.open > 0;
	const hasAfter = fence.close < lines.length - 1;
	if (hasAfter && blank(fence.close + 1) && (!hasBefore || blank(fence.open - 1))) return { from: fence.open, to: fence.close + 1 };
	if (!hasAfter && hasBefore && blank(fence.open - 1)) return { from: fence.open - 1, to: fence.close };
	return { from: fence.open, to: fence.close };
}

/** Entfernt den Block (siehe `fenceRemovalLines`) aus der Notiz. */
export function removeFence(noteText: string, fence: InkFence): string {
	const eol = noteText.includes("\r\n") ? "\r\n" : "\n";
	const lines = noteText.split(/\r?\n/);
	const { from, to } = fenceRemovalLines(lines, fence);
	lines.splice(from, to - from + 1);
	return lines.join(eol);
}

/** Ersetzt den Inhalt zwischen den Fence-Zeilen. */
export function replaceFenceBody(noteText: string, fence: InkFence, body: string): string {
	const eol = noteText.includes("\r\n") ? "\r\n" : "\n";
	const lines = noteText.split(/\r?\n/);
	const bodyLines = body === "" ? [] : body.replace(/\r?\n$/, "").split(/\r?\n/);
	lines.splice(fence.open + 1, fence.close - fence.open - 1, ...bodyLines);
	return lines.join(eol);
}
