import type { Bounds } from "../model/ops";

/** Höhe einer Kachel (CSS-px) für die fertigen Striche. Hält Canvas-Größen klein. */
export const TILE_HEIGHT = 1024;

export interface Tile {
	top: number;
	height: number;
}

/** Doc-Einheiten → CSS-px. */
export function scaleFor(docWidth: number, cssWidth: number): number {
	return cssWidth / docWidth;
}

export function tileLayout(cssHeight: number, tileHeight = TILE_HEIGHT): Tile[] {
	const tiles: Tile[] = [];
	for (let top = 0; top < cssHeight; top += tileHeight) {
		tiles.push({ top, height: Math.min(tileHeight, cssHeight - top) });
	}
	return tiles;
}

/** Indizes der Kacheln, die ein Bereich (Doc-Einheiten) berührt. */
export function tilesForBounds(b: Bounds, scale: number, tiles: Tile[]): number[] {
	const top = b.minY * scale;
	const bottom = b.maxY * scale;
	const hits: number[] = [];
	tiles.forEach((t, i) => {
		if (bottom >= t.top && top <= t.top + t.height) hits.push(i);
	});
	return hits;
}
