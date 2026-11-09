import { strokeLine, type InkData, type Stroke } from "./ink-format";

/** Abweichung, die die Datei durch Quantisierung erzeugt (x/y: 1/q mit q = 10, Druck: 1/255) – plus Rundung. */
const COORD_TOL = 0.05 + 1e-6;
const PRESSURE_TOL = 0.5 / 255 + 1e-6;

/**
 * Gleicher Strich, nur einmal durch die Datei gegangen? Gleiche ID und Eigenschaften, Punkte bis auf die
 * Quantisierung gleich (eigene, noch nicht neu geladene Striche haben ungerundete Punkte).
 */
export function sameStroke(a: Stroke, b: Stroke): boolean {
	if (a === b) return true;
	if (a.id !== b.id || a.tool !== b.tool || a.color !== b.color || a.size !== b.size) return false;
	if (!!a.simulated !== !!b.simulated || !!a.shape !== !!b.shape) return false;
	const p = a.points;
	const q = b.points;
	if (p.length !== q.length) return false;
	for (let i = 0; i < p.length; i += 3) {
		if (Math.abs(p[i] - q[i]) > COORD_TOL || Math.abs(p[i + 1] - q[i + 1]) > COORD_TOL) return false;
		if (Math.abs(p[i + 2] - q[i + 2]) > PRESSURE_TOL) return false;
	}
	// Zusätzlich exakt: dieselbe Dateizeile (schließt Fälle aus, in denen die Toleranz zwei verschieden
	// gerundete Fassungen gleichsetzen würde)
	return strokeLine(a) === strokeLine(b);
}

/**
 * Frisch gelesene Striche durch die schon bekannten, gleichen Objekte ersetzen (ändert `incoming`).
 * Striche sind unveränderlich, an ihrem Objekt hängen Pfad- und Bounds-Cache: Nach einer fremden Änderung
 * (Sync, Zusammenarbeit) muss so nur neu berechnet und gemalt werden, was wirklich neu ist.
 */
export function reuseStrokes(known: readonly Stroke[], incoming: InkData): InkData {
	if (!known.length || !incoming.strokes.length) return incoming;
	const byId = new Map<string, Stroke>();
	for (const s of known) if (!byId.has(s.id)) byId.set(s.id, s);
	incoming.strokes = incoming.strokes.map((s) => {
		const k = byId.get(s.id);
		return k && sameStroke(k, s) ? k : s;
	});
	return incoming;
}
