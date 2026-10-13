# Texterkennung (Handschrift → durchsuchbarer Text)

**Vorgaben:**
- nur kostenlose Erkennung, keine API-Keys
- keine separaten Programme (kein Python, Ollama, lokaler LLM-Server oder System-Tesseract)
- alles läuft im Plugin
- Einsatz für die **Vault-Suche** und die **Lernplattform**

## Engine-Kette

| Prio | Engine | Lizenz / Größe | Deutsch-Handschrift | Rolle |
|---|---|---|---|---|
| 1 | [`naeyn/de-htr-web-v2`](https://huggingface.co/naeyn/de-htr-web-v2) (CTC, ONNX) | Apache-2.0, int8 10,4 MB | CER ca. 8 % auf Zeilen von 78 unbekannten Schreibern, ca. 250 ms pro Zeile (WASM) | Standard |
| 2 | [`naeyn/de-htr-web`](https://huggingface.co/naeyn/de-htr-web) v1 (CTC, ONNX) | Apache-2.0, int8 ca. 10 MB | CER ca. 8,6 % | Fallback |
| 3 | [Tesseract.js](https://github.com/naptha/tesseract.js) (WASM, `deu`) | Apache-2.0 | CER ca. 43 % (laut Benchmark im de-htr-web-Repo) | letzter Fallback, liefert grobe Stichworte |

In den Settings steht „Auto“ für die Reihenfolge v2 → v1 → Tesseract.js. Ein Fallback greift, wenn der Download oder das Laden scheitert. Die Engine lässt sich auch manuell festlegen.

**Geprüft (2026-10-13):** Das Alphabet in der `config.json` beider de-htr-Modelle enthält `ä ö ü Ä Ö Ü ß : / .`, also auch genug für IPv6-Adressen und Subnetzmasken.
**Offen:**
- Das Modell ist neu (08/2026) und teils mit Handschrift-Fonts trainiert. Die Qualität auf echter Stiftschrift muss getestet werden.
- Die WebGPU-Verfügbarkeit in Electron 43 unter Linux ist ungeprüft, deshalb vorerst nur WASM.

### Verworfen

- **TrOCR** (transformers.js): Für Deutsch gibt es nur einen 2,4-GB-Fine-Tune ohne ONNX, dazu ca. 2 s pro Zeile.
- **Chromium Handwriting API:** nur unter ChromeOS verfügbar.
- **Google Input Tools** (inoffiziell): Cloud und ToS-Grauzone.
- **Alles Kostenpflichtige oder mit API-Key.**

## Preprocessing laut `config.json`

| | v2 | v1 |
|---|---|---|
| Input-Name | `image` | `images` |
| Kanäle | 1 (Graustufen) | 3 (RGB) |
| Höhe | 64 px, Seitenverhältnis bleibt | 64 px |
| max. Breite | 1024 (längere Zeilen teilen) | 2048 |
| Normalisierung | Pixel / 255 → [0,1], **keine** Mean/Std (passiert im Modell) | ImageNet mean `[0.485,0.456,0.406]`, std `[0.229,0.224,0.225]` |
| Padding | rechts mit Weiß (1.0) auf ein Vielfaches von 4 | – |
| Output | `logits`, CTC, Blank-Index 0, Stride 4 | `log_probs`, CTC, Blank-Index 0 |

## Pipeline im Plugin

Alles läuft lokal in einem Web Worker.

1. **Strokes zu Zeilen.** Weil Strokes vorliegen, ist das einfacher als bei einem Scan:
   - Strokes nach y-Schwerpunkt und Überlappung der Bounding-Boxes clustern
   - neue Zeile bei einer Lücke über etwa 1,5× der mittleren Zeilenhöhe
   - Zeilen von oben nach unten sortieren
   - Bei PDF-Hintergrund nur die Ink-Strokes verwenden.
2. **Rendern.** Jede Zeile wird schwarz auf weiß auf einen `OffscreenCanvas` gezeichnet, mit einheitlicher Strichstärke und dem Preprocessing aus der Tabelle oben.
3. **Inferenz.** [onnxruntime-web](https://www.npmjs.com/package/onnxruntime-web) (MIT), WASM-Backend mit `numThreads = 1`, damit weder SharedArrayBuffer noch Cross-Origin-Isolation nötig sind. Das Ergebnis per greedy CTC decodieren: argmax, Wiederholungen zusammenfassen, Blanks entfernen.
4. **Modell und WASM.** Werden beim ersten Aktivieren einmalig von Hugging Face bzw. jsDelivr in `<plugin>/models/` geladen und per SHA-256 geprüft. Danach läuft alles komplett offline.
   - Die WASM-Binary wird über `ort.env.wasm.wasmBinary` als ArrayBuffer übergeben, damit kein `fetch` auf `app://` nötig ist.
   - Community-Plugins dürfen nur `main.js`, `manifest.json` und `styles.css` ausliefern. Deshalb gibt es den Download, und er wird im README offengelegt.
5. **Auslöser.** Nach Leerlauf (ca. 10 s nach dem letzten Strich) oder per Command „Handschrift erkennen“. Ein Cache pro Zeile (Hash über die Strokes) sorgt dafür, dass nur geänderte Zeilen neu erkannt werden.

## Wohin der Text geschrieben wird

Ins Feld `text:` des `ink`-Codeblocks, direkt in die .md:

````markdown
```ink
file: _ink/2026-10-13-subnetting-a1b2.ink
text: |
  2001:db8::/32 → 65536 /48-Netze
```
````

- Die .md wird **nur** geändert, wenn sich der erkannte Text tatsächlich ändert. Das hält die Zahl der LiveSync-Revisionen klein.
- **Obsidian:** Die Kernsuche und Omnisearch indizieren den Rohtext der Notiz, also auch den Inhalt des Codeblocks.
- **Lernplattform** (`~/Projekte/lernplattform`):
  - Import des Vaults von der Platte (`MARKDOWN_VAULT_ROOT`) oder per LiveSync/CouchDB (`src/lib/markdown-source.ts`).
  - Die FTS5-Suche (`src/lib/fts.ts`, `tokenize='unicode61 remove_diacritics 2'`) indiziert Chunk-Inhalte. `markdownToSearchText` (`src/lib/markdown-normalize.ts`) entfernt bei Codeblöcken nur die Fence-Marker. → **Der erkannte Text ist dort ohne Änderung durchsuchbar.** `remove_diacritics` verzeiht dabei sogar Umlaut-Fehler der OCR.
  - Optionaler Folgeschritt dort: In `src/components/app/common/markdown.tsx` einen Zweig für `language-ink` neben `mermaid`/`dgmo` einbauen, der die SVG-Vorschau und den erkannten Text zeigt, statt den rohen Codeblock.
