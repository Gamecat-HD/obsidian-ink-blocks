# Spike-Ergebnisse (2026-10-13)

Gemessen in einer isolierten, headless Obsidian-1.14.4-Instanz (Electron 43, Linux) über den E2E-Harness (`scripts/e2e/`). Die Tests liegen unter `scripts/e2e/tests/spike-*.mjs` und lassen sich erneut ausführen.

## S1: onnxruntime-web im Worker ✅

- `import * as ort from "onnxruntime-web/wasm"` löst bei esbuild (ESM) auf `ort.wasm.bundle.min.mjs` auf, also mit eingebautem Glue. Das Worker-Bundle ist **72 KB** groß (minifiziert).
- Blob-URL-Modul-Worker (`new Worker(blobUrl, {type: "module"})`) mit `env.wasm.wasmBinary` (ArrayBuffer, 14 MB `ort-wasm-simd-threaded.wasm`), `numThreads = 1`, `proxy = false`: läuft.
- Session für `de-htr-web-v2` laden: ca. 215 ms.
- **Output-Form bei v2: `[1, T, C]`** (batch-first, C = 112). Das v1-Referenzskript erwartet `[T, 1, C]`, daher die Achsen aus `dims` lesen.
- Klasse `k` entspricht `alphabet[k-1]`, Blank ist 0. Gültig sind nur `ceil(realWidth / 4)` Zeitschritte.
- Laufzeit ca. **9 ms pro Zeitschritt**: eine 200-px-Zeile braucht ca. 0,5 s, eine 600-px-Zeile ca. 1,3 s (single-threaded). Obsidian hat `SharedArrayBuffer` aktiv, Multithreading ist eine spätere Option.
- Ergebnis auf gerenderter Schrift: „Subnetzmaske 255.255.255.0“ wird exakt erkannt, „Größe über Maß“ als „Größe über Mäß“, „Hallo Welt“ (cursive) als „Fallo Welt“.

## S2: pdf.js über `loadPdfJs()` ✅

- pdf.js **5.3.34**, `GlobalWorkerOptions.workerSrc` ist bereits gesetzt (`/lib/pdfjs/pdf.worker.min.mjs`).
- `page.render({ canvasContext, viewport })` funktioniert. `render({ canvas, viewport })` allein wirft einen Fehler.
- Rendern auf einen `OffscreenCanvas` funktioniert ebenfalls.
- A4 bei Scale 1 ergibt `595.28 × 841.89` (PDF-Punkte).

## S3: tesseract.js offline ✅ (mit Workaround)

- tesseract.js 7.0.0 hat einen **Bug**: Sprach-Objekte `{code, data}` werden geladen, aber `initialize` übergibt `l.data` statt `l.code` als Sprachnamen, und die Initialisierung schlägt fehl.
- **Funktioniert:**
  - `workerPath` als Blob-URL von `worker.min.js`, `workerBlobURL: false`
  - `corePath` als Blob-URL von `tesseract-core-simd-lstm.wasm.js` mit Suffix `#core.js`, weil tesseract eine Endung `js` erwartet
  - **Variante A (gewählt):** `langPath` ist die Obsidian-Ressourcen-URL des Modellordners (`adapter.getResourcePath(dir)` ohne Query), mit `cacheMethod: "none"`. Der Worker kann `app://`-URLs fetchen.
  - Variante B: tesseracts IndexedDB-Cache (`keyval-store`/`keyval`, Key `<cachePath>/deu.traineddata`) vorbefüllen, mit `cacheMethod: "readOnly"`.
- Laden ca. 150 ms, Erkennen einer Zeile ca. 80 ms. `deu.traineddata.gz` (best_int) ist 1,3 MB groß.

## S4: Live Preview und Re-Render ✅

- Ein Edit **außerhalb** des Blocks rendert ihn nicht neu.
- Ein Edit **innerhalb** des Blocks (z. B. an der `text:`-Zeile) **zerstört den `MarkdownRenderChild` und erzeugt ihn neu**. Der State (Doc, History) muss also im `InkStore` liegen.
- Ein Klick auf den gerenderten Block setzt den Editor-Cursor **nicht** in den Block, Live Preview bleibt gerendert.
