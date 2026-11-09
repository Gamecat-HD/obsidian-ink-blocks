/**
 * Lange Schleifen auf dem Hauptthread in Häppchen teilen: `await slice()` gibt nach `budgetMs` Arbeit einmal
 * an die Ereignisschleife ab (Zeichnen, Stifteingaben). Ein `await` auf schon fertige Promises (z. B.
 * `cachedRead` einer geladenen Notiz) tut das nicht – es läuft als Microtask sofort weiter.
 */
export function timeSlicer(budgetMs = 8): () => Promise<void> {
	let start = performance.now();
	return async () => {
		if (performance.now() - start < budgetMs) return;
		await new Promise<void>((resolve) => setTimeout(resolve, 0));
		start = performance.now();
	};
}
