import type { InkData, Stroke } from "./ink-format";

/**
 * 3-Wege-Merge per Stroke-ID für gleichzeitige Änderungen (z. B. LiveSync von einem zweiten Gerät).
 * Striche sind unveränderlich, daher genügt Mengenlogik:
 *  - lokal hinzugefügt (nicht in base) bleibt,
 *  - entfernt hinzugefügt (nicht in base) bleibt,
 *  - auf einer Seite gelöscht (in base, fehlt dort) wird gelöscht.
 * Reihenfolge: remote-Reihenfolge, danach lokal neue Striche.
 */
export function mergeInk(base: InkData, local: InkData, remote: InkData): InkData {
	const baseIds = new Set(base.strokes.map((s) => s.id));
	const localIds = new Set(local.strokes.map((s) => s.id));
	const remoteIds = new Set(remote.strokes.map((s) => s.id));

	const keep = (s: Stroke, otherIds: Set<string>) => !baseIds.has(s.id) || otherIds.has(s.id);
	const strokes = [
		...remote.strokes.filter((s) => keep(s, localIds)),
		...local.strokes.filter((s) => !remoteIds.has(s.id) && !baseIds.has(s.id)),
	];

	return {
		...remote,
		h: Math.max(local.h, remote.h),
		strokes,
		ocr: remote.ocr ?? local.ocr,
	};
}
