import type { Stroke } from "../model/ink-format";
import { strokeBounds, type Bounds } from "../model/ops";

/** Höhe eines Bands (Doc-Einheiten). Etwa eine Schreibzeile – kleine Bereiche treffen 1–2 Bänder. */
const BAND = 64;
/** Striche, die mehr Bänder überspannen, landen in einer eigenen Liste (z. B. riesig skalierte Auswahl). */
const MAX_BANDS = 256;

/**
 * Räumlicher Index der Striche eines Dokuments: horizontale Bänder in Doc-Einheiten. Neuzeichnen eines
 * Bereichs (Kachel, Strich-Ende, Radierer) fragt nur die Striche der betroffenen Bänder ab, statt alle zu prüfen.
 *
 * Der Index kennt keine Mutationen: `sync` vergleicht die Strichliste per Objektidentität (billig, O(n)) und
 * baut bei jeder Abweichung neu auf. Striche sind unveränderlich (neue Form = neues Objekt), daher genügt das.
 */
export class StrokeIndex {
	private strokes: Stroke[] = [];
	private bands: number[][] = [];
	private wide: number[] = [];
	private stamp = new Uint32Array(0);
	private gen = 0;

	/** Mit der aktuellen Strichliste abgleichen; `true`, wenn neu aufgebaut wurde. */
	sync(list: readonly Stroke[]): boolean {
		const cur = this.strokes;
		if (cur.length === list.length) {
			let same = true;
			for (let i = 0; i < list.length; i++) {
				if (cur[i] !== list[i]) {
					same = false;
					break;
				}
			}
			if (same) return false;
		}
		this.build(list);
		return true;
	}

	/** Stand beim letzten Abgleich (Doc-Reihenfolge). */
	get list(): readonly Stroke[] {
		return this.strokes;
	}

	private build(list: readonly Stroke[]) {
		this.strokes = list.slice();
		this.bands = [];
		this.wide = [];
		if (this.stamp.length < list.length) this.stamp = new Uint32Array(Math.max(64, list.length * 2));
		this.stamp.fill(0);
		this.gen = 0;
		for (let i = 0; i < list.length; i++) {
			const b = strokeBounds(list[i]);
			const lo = Math.max(0, Math.floor(b.minY / BAND));
			const hi = Math.floor(b.maxY / BAND);
			if (!(hi >= lo)) {
				// NaN o. Ä.: immer prüfen (die genaue Abfrage entscheidet)
				this.wide.push(i);
				continue;
			}
			if (hi - lo > MAX_BANDS) {
				this.wide.push(i);
				continue;
			}
			for (let k = lo; k <= hi; k++) (this.bands[k] ??= []).push(i);
		}
	}

	/**
	 * Striche, deren Bounds den Bereich berühren – in Doc-Reihenfolge (wichtig für die Malreihenfolge).
	 * Gleiche Bedingung wie vorher der Filter über alle Striche.
	 */
	query(top: number, bottom: number, left = -Infinity, right = Infinity): Stroke[] {
		const out: number[] = [];
		if (++this.gen === 0xffffffff) {
			this.stamp.fill(0);
			this.gen = 1;
		}
		const gen = this.gen;
		const stamp = this.stamp;
		const take = (i: number) => {
			if (stamp[i] === gen) return;
			stamp[i] = gen;
			const b = strokeBounds(this.strokes[i]);
			if (b.maxY < top || b.minY > bottom) return;
			if (b.maxX < left || b.minX > right) return;
			out.push(i);
		};
		const lo = Math.max(0, Math.floor(top / BAND));
		// Striche oberhalb von 0 stehen in Band 0 (bzw. in `wide`), daher auch negative Bereiche auf Band 0 abbilden.
		const hi = Math.min(this.bands.length - 1, Math.max(0, Math.floor(bottom / BAND)));
		for (let k = lo; k <= hi; k++) {
			const band = this.bands[k];
			if (band) for (const i of band) take(i);
		}
		for (const i of this.wide) take(i);
		out.sort((a, b) => a - b);
		return out.map((i) => this.strokes[i]);
	}
}

/**
 * Bereiche, die sich zwischen zwei Strichlisten unterscheiden (entfernte und hinzugekommene Striche, per
 * Objektidentität). `null`, wenn sich die Reihenfolge gemeinsamer Striche geändert hat – dann alles neu malen
 * (überlappende Striche verschiedener Farben lägen sonst falsch übereinander).
 */
export function strokeDiff(before: readonly Stroke[], after: readonly Stroke[]): Bounds[] | null {
	// Gemeinsamer Anfang und Schluss (der Normalfall: ein Strich hinzu oder ein paar entfernt) ohne Mengen
	const n = Math.min(before.length, after.length);
	let a = 0;
	while (a < n && before[a] === after[a]) a++;
	let z = 0;
	while (z < n - a && before[before.length - 1 - z] === after[after.length - 1 - z]) z++;
	const b = before.slice(a, before.length - z);
	const c = after.slice(a, after.length - z);
	if (!b.length && !c.length) return [];
	const inB = new Set(b);
	const inC = new Set(c);
	const dirty: Bounds[] = [];
	for (const s of b) if (!inC.has(s)) dirty.push(strokeBounds(s));
	for (const s of c) if (!inB.has(s)) dirty.push(strokeBounds(s));
	let j = 0;
	for (const s of b) {
		if (!inC.has(s)) continue;
		while (j < c.length && !inB.has(c[j])) j++;
		if (c[j] !== s) return null;
		j++;
	}
	return dirty;
}
