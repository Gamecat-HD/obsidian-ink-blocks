# Ink Blocks: Aufbau des Plugins (Phase 1–3)

## Context
Das Repo `~/projects/obsidian-ink-blocks` (GitHub `Gamecat-HD/obsidian-ink-blocks`, privat) steht bei Phase 0: Analyse in `docs/`, ein Stub für den `ink`-Codeblock und der Command „Pen diagnostics“.
Jetzt kommt der eigentliche Aufbau, in drei Stufen:
1. Handschrift inline in Notizen (Heft-Modus)
2. Arbeitsblätter mit PDF- bzw. Bild-Hintergrund
3. Lokale, kostenlose Texterkennung. Das Ergebnis landet im Feld `text:` und ist damit in Obsidian und in der Lernplattform durchsuchbar.

**Vom Nutzer festgelegt:**
- Umfang Phase 1–3, ohne Lasso, PDF-Export, CM6-Widget oder Lernplattform-Renderer
- **Heft-Modus:** volle Notizbreite, wächst nach unten mit, Hintergrund liniert, kariert oder leer
- Ablage zentral in **`_ink/`** (in den Settings änderbar)
- **schwebende Mini-Toolbar** am Block
- OCR nur kostenlos und lokal: `de-htr-web-v2` → v1 → Tesseract.js

**Geprüfte Fakten:**
- obsidian.d.ts 1.14 enthält `ctx.getSectionInfo(el)` (0-basiert, kann `null` liefern), `vault.process`, `adapter.writeBinary`, `requestUrl().arrayBuffer`, `loadPdfJs()`, `metadataCache.getFirstLinkpathDest`, `parseLinktext`, `Scope` und `keymap.pushScope`, `debounce` sowie `manifest.dir`.
- onnxruntime-web 1.30.0 kennt `env.wasm.wasmBinary`. Ist es gesetzt, wird `wasmPaths` ignoriert.
- tesseract.js liegt bei 7.0.0. Das installierte text-extractor-Plugin nutzt tesseract.js in Obsidian bereits (`workerBlobURL: true`), es gibt also einen Präzedenzfall.
- Wiederverwendbar ist das Pointer-Handling aus `src/diagnostics.ts`: coalesced Events, `buttons&32` und `&2`, Canvas-Größe mit DPR.

---

## 1. Modulaufbau (`src/`)
**P** = pure: kein Import von `obsidian` oder DOM, per Unit-Test prüfbar.

```
main.ts                   Verdrahtung: Settings, Codeblock-Prozessor, Commands, Store/OCR-Lifecycle
settings.ts               InkSettings + Defaults + SettingTab (Ordner, Palette, Toolbar-State, OCR-Engine, Modell-Download)
commands.ts               "Schreibfläche einfügen", "Arbeitsblatt einfügen" (Fuzzy-Pick PDF/Bild + Seite),
                          "Handschrift erkennen (Notiz)", "OCR-Modelle laden", "Pen diagnostics"
diagnostics.ts            (bestehend)
util/ids.ts          P    shortId (4×base36), slug (ä→ae, ß→ss, max 40), Dateiname <YYYY-MM-DD>-<slug>-<id>.ink
util/hash.ts         P    FNV-1a (Cache-Keys), sha256 via crypto.subtle
block/source.ts      P    Block-Body parsen/serialisieren (file, bg, bgStyle, `text: |`); setField() lässt Rest unverändert
block/locate.ts      P    Fence-Range für (Notiztext, Hint-Zeile, inkPath) finden; ``` und ~~~, Duplikate
block/BlockWriter.ts      text:/bgStyle: zurückschreiben – Editor-API wenn Notiz offen, sonst vault.process; nur bei Änderung
block/InkBlockChild.ts    MarkdownRenderChild: Platzhalter → Lazy-Init (IntersectionObserver), besitzt Surface/Toolbar/Pipeline
model/ink-format.ts  P    Schema v1, encode/decode (Quantisierung + Delta), validate, migrate
model/InkDoc.ts      P    Strokes (geordnete Map), Bounds-Cache, applyOp/invertOp, Wachstumsregel
model/history.ts     P    Undo/Redo-Stack aus Ops (max 200)
model/merge.ts       P    3-Wege-Merge per Stroke-ID (base/local/remote) für LiveSync-Updates
store/InkStore.ts         ref-gezählter Cache je Pfad {doc, history, base, dirty}, Save-Debounce 1,5 s,
                          Erkennung eigener Writes, Events modify/rename/delete/create
render/transform.ts  P    Doc-Einheiten ↔ CSS-px ↔ Device-px, Kachel-Mathe
render/svgPath.ts    P    getSvgPathFromStroke (perfect-freehand-Helper)
render/strokes.ts         perfect-freehand-Optionen je Werkzeug, Path2D-Cache je Stroke-ID
render/Surface.ts         Layer: Hintergrund, Kacheln mit fertigen Strichen (1024 px hoch), Live-Canvas (desynchronized);
                          ResizeObserver, DPR-matchMedia
render/patterns.ts        liniert/kariert/leer in Theme-Farben
render/background.ts      PdfBackground (loadPdfJs, LRU-Doc-Cache) + ImageBackground, Bitmap-Cache (Pfad, Seite, px-Breite)
input/PointerPipeline.ts  Pointer Events → Werkzeug; coalesced; Palm Rejection; Radierer/Seitentaste
input/tools.ts            Pen, Highlighter, Eraser
input/hitTest.ts     P    Abstände Punkt/Segment, Radierpfad vs. Stroke-Polylinie mit BBox-Vorfilter
input/keyScope.ts         Scope für Mod+Z / Mod+Shift+Z / Mod+Y, nur solange der Block aktiv ist
ui/Toolbar.ts             schwebend/sticky: Stift, Textmarker, Radierer, 3 Farben, 2 Stärken, Undo/Redo, Hintergrund
ocr/segment.ts       P    Strokes → Zeilen/Segmente, Breiten-Split
ocr/preprocess.ts    P    Zeilen-Transform, Pixel → Float32-Tensor (v2 Grau, v1 RGB+ImageNet), Rechts-Padding
ocr/ctc.ts           P    Greedy-Decode, Konfidenz, Alphabet aus config.json
ocr/models.ts             Manifest (feste URLs + sha256 + Größe), Download (.part → rename), Prüfung, Status
ocr/engines/types.ts      interface Engine { id; load(); recognize(lines): string[] }
ocr/engines/htr.ts        ORT-Engine, parametrisiert (v2/v1), läuft im Worker
ocr/engines/tesseract.ts  tesseract.js (eigener Worker), letzter Fallback
ocr/worker.ts             Worker-Entry: ORT-Session, Rasterisieren auf OffscreenCanvas, Decode
ocr/workerClient.ts       Blob-URL-Worker aus virtuellem Modul, RPC mit Transferables
ocr/OcrService.ts         Queue mit 10 s Leerlauf je Doc, Zeilen-Cache, Fallback-Kette, ruft BlockWriter
```

## 2. Datenformat `.ink` v1
```json
{ "v":1, "id":"a1b2", "space":"nb|page", "w":1000, "h":800,
  "bg":{"kind":"pdf","page":2,"pw":595.28,"ph":841.89},
  "q":10,
  "strokes":[{"id":"k3f9x","t":"pen|hl","c":0,"s":3,"p":[x0,y0,p0, dx,dy,dp, …]}],
  "ocr":{"eng":"htr-v2@<sha8>","lines":{"<hash>":"text"},"written":"<fnv>"} }
```
- **Heft-Modus:** `w = 1000` Einheiten entsprechen immer der Blockbreite. y nutzt dieselbe Einheit, das Seitenverhältnis bleibt also bei jeder Fensterbreite gleich.
- **Höhe** `h` steht in der `.ink`-Datei, nicht im Block. Wachsen schreibt daher nie in die .md.
- **Seiten-Modus:** `w`/`h` sind PDF-Punkte (Scale 1) bzw. Bild-Pixel, die Höhe ist fest. In beiden Modi gilt `scale = cssBreite / w`.
- **Punkte:** Koordinaten als `round(x·q)`, Druck 0..255, delta-codiert, ca. 1 KB pro 100 Punkte.
- **Farben:** Palettenindex. `c=0` ist „Tinte“, also `--text-normal` im Heft-Modus und Schwarz auf PDF/Bild.
- **Strokes sind unveränderlich.** Der Radierer entfernt nur ganze Strokes. Darauf bauen Undo-Ops, Merge und der OCR-Zeilen-Cache auf (`fnv(sortierte IDs + Engine)`).

## 3. Kernalgorithmen
- **Auto-Grow:** Kommt ein Live-Punkt in die Nähe des unteren Rands (`y > h − 120`), wächst `h` um 300 (Minimum 400). Neue Kacheln werden angehängt, es wird nichts gelöscht. Das Wachsen ist Teil der `add`-Op (`hBefore`/`hAfter`), Undo schrumpft also wieder. Automatisches Schrumpfen gibt es nicht.
- **Rendering:**
  - Kacheln werden lazy angelegt (IntersectionObserver).
  - Transform `setTransform(dpr·scale,0,0,dpr·scale,0,−tileTop·dpr)`.
  - Ein fertiger Strich wird nur in die Kacheln gezeichnet, die seine BBox berührt.
  - Bei Radieren, Undo, Merge oder Reload werden nur die betroffenen Kacheln neu gezeichnet. Textmarker kommen zuerst (Alpha 0,35), dann die Stifte.
  - Bei Resize wird pro rAF zusammengefasst, das PDF-Bitmap nach 200 ms Debounce neu gerendert.
- **Eingabe:**
  - Am Container `stopPropagation` auf pointerdown, mousedown, click und touchstart, damit Live Preview nicht in den Quelltext springt.
  - Radierer über `buttons&32` oder die Seitentaste `&2` (in den Settings einstellbar).
  - Palm Rejection: Touch wird ignoriert, solange der Stift unten ist, und noch 500 ms danach.
  - Setting „Nur Stift zeichnet“ setzt `touch-action: pan-y`, sonst `none`.
  - Die Maus zeichnet mit simuliertem Druck.
  - Punkte unter 0,3 Einheiten Abstand werden verworfen. Bei `pointercancel` wird der Strich verworfen.
- **Radierer:** Segment-gegen-Segment-Test mit Toleranz `r + s/2` nach BBox-Vorfilter. Getroffene Striche verschwinden sofort. Beim pointerup wird daraus eine `erase`-Op.
- **Undo/Redo:** Ops `add`/`erase`/`clear` mit apply/invert. Die History liegt im InkStore, damit sie ein Neu-Rendern in Live Preview übersteht. Die Tastenkürzel laufen über `keymap.pushScope`, solange der Block aktiv ist; ein Klick außerhalb poppt den Scope wieder.
- **Zeilensegmentierung (OCR):**
  1. Nur Stift-Striche berücksichtigen. H = Median der Strichhöhen.
  2. Nach y-Mitte sortieren. Ein Strich kommt zu der Zeile, mit der er mindestens 50 % überlappt oder deren Mitte weniger als 0,5H entfernt ist.
  3. Kleine Striche (Pünktchen, Umlaut-Punkte) gehen an die nächste Zeile.
  4. Eine x-Lücke über 3H trennt Segmente. Das deckt getrennte Antwortfelder auf Arbeitsblättern ab.
  5. Breiter als 1024 px (bei 64 px Höhe): an der größten Lücke teilen.
- **Preprocessing und Decode:** im Worker auf einem OffscreenCanvas, schwarz auf weiß, einheitliche Strichstärke.
  - v2: `[1,1,64,W]`, Werte /255, rechts mit 1.0 auf ein Vielfaches von 4 aufgefüllt.
  - v1: drei Kanäle mit ImageNet mean/std.
  - CTC greedy: argmax, Wiederholungen zusammenfassen, Blank 0 entfernen. Die Achsenreihenfolge des Outputs wird im Spike geprüft.
- **`text:` schreiben, ohne Nutzer-Edits zu überschreiben:**
  1. Ist der Text unverändert, wird nichts geschrieben.
  2. Hat der Nutzer `text:` selbst editiert (Hash ≠ `ocr.written`), wird übersprungen, außer per Command erzwungen.
  3. Steht der Cursor im Block oder läuft gerade ein Strich, wird verschoben.
  4. Den Block über `getSectionInfo` finden und prüfen, ob die `file:`-Zeile passt. Sonst alle `ink`-Fences nach `file:` durchsuchen.
  5. Ist die Notiz offen, per `editor.replaceRange` nur die `text:`-Zeilen ersetzen. Sonst `vault.process` mit erneuter Suche im Callback.
  6. Dreifache Backticks werden aus dem OCR-Text entfernt.
- **Worker-Bundling:**
  - Ein esbuild-Plugin baut `src/ocr/worker.ts` separat (ESM, `write:false`) und stellt es als `virtual:ocr-worker` (String) bereit.
  - Zur Laufzeit `new Worker(blobURL, {type:"module"})`. Wasm und Modell gehen als transferierte ArrayBuffer hinein (`wasmBinary`, `numThreads=1`, `proxy=false`).
  - `onnxruntime-web` wird **exakt** gepinnt. `define __ORT_VERSION__` erzeugt die jsDelivr-URL für das Wasm, damit JS und Wasm nicht auseinanderlaufen.
- **InkStore:**
  - Ist eine `.ink`-Datei nicht vorhanden (z. B. weil LiveSync noch synchronisiert), zeigt der Block einen Platzhalter und wartet auf das `create`-Event. Beim Rendern werden nie Dateien angelegt, das macht nur der Insert-Command.
  - Ändert sich die Datei von außen: ohne lokale Änderungen neu laden, sonst `merge(base, local, remote)`.
  - Wird eine `.ink`-Datei umbenannt, werden die `file:`-Zeilen in den verweisenden Notizen angepasst.
  - Beim Unload werden die Debouncer geflusht.

## 4. Meilensteine (Reihenfolge der Umsetzung)
**Zuerst Spikes, je mit Zeitlimit:**
- **S1 ORT:** v2 im Blob-Worker auf einer synthetischen Zeile laufen lassen. Für den Glue drei Varianten in dieser Reihenfolge: (a) `onnxruntime-web/wasm`-Bundle-Entry, (b) `wasmPaths` als Objekt mit Blob-URLs, (c) Glue als String bündeln. ms pro Zeile und Output-Dims notieren.
- **S2 pdf.js:** `pdfjs.version` loggen. Prüfen, ob `render` `{canvas}` braucht und ob `workerSrc` schon gesetzt ist.
- **S3 Tesseract offline:** Funktionieren Blob-`corePath` und lokaler `langPath`? Sonst einmal remote laden und tesseracts IndexedDB-Cache nutzen.
- **S4 Live Preview:** Wird der Block neu erzeugt, wenn sich sein Quelltext ändert? Wie stark flackert es?

| M | Inhalt | Abnahme |
|---|---|---|
| M1 Block + Speicher | ids, ink-format, source, locate, InkStore, Insert-Command, Platzhalter, vitest-Setup | Command legt `_ink/<datum>-<slug>-<id>.ink` an und fügt den Block ein. Reload, fehlende, umbenannte und gelöschte Dateien funktionieren. Unit-Tests grün |
| M2 Zeichnen | Surface/Kacheln, PointerPipeline, Pen/Highlighter/Eraser, Save-Debounce | Druckstriche flüssig (Stift und Maus). Klick in Live Preview öffnet nicht den Quelltext. Übersteht Resize, Zoom und Neustart. 20 schnelle Striche ergeben höchstens 3 Saves |
| M3 Toolbar/Undo/Grow | Toolbar, History, keyScope, Auto-Grow, `bgStyle`-Toggle, Lazy-Init | Ctrl+Z wirkt nur bei aktivem Block auf die Tinte, sonst auf den Text. Undo übersteht ein Re-Render. Wachsen ohne Flackern. Notiz mit 10 Blöcken öffnet schnell |
| M4 Arbeitsblatt | `bg:` auflösen, PdfBackground/ImageBackground, Seiten-Modus, Command „Arbeitsblatt einfügen“ | `#page=N` scharf bei DPR 1 und 2. Striche bleiben bei jeder Breite deckungsgleich. Fehlende PDF zeigt einen klaren Fehler |
| M5 OCR v2 | models.ts (Download mit Zustimmung, SHA), Worker, segment, preprocess, ctc, OcrService, `text:` | Nach dem Download offline lauffähig. `text:` erscheint ca. 10 s nach dem Schreiben und ist in Suche und Omnisearch auffindbar. Ein Lauf ohne Änderung schreibt nichts. Eigene Edits bleiben erhalten |
| M6 Fallbacks | v1-Spec, Tesseract-Stufe, Auto-Kette, Engine-Status in den Settings | Werden die v2-Dateien gelöscht, fällt Auto auf v1 und dann auf Tesseract zurück, jeweils mit Notice. Eine manuelle Engine-Wahl wird respektiert |
| M7 Politur + Doku | Settings komplett, LiveSync-Merge, Command für verwaiste `.ink`-Dateien, README-Offenlegung, Doku aktualisiert, CER auf 30 eigenen Zeilen | Checkliste unten erfüllt |

Nach jedem Meilenstein wird committet und gepusht.
Neue Dependencies: `onnxruntime-web@1.30.0` (exakt), `tesseract.js@7`, dev: `vitest`. `perfect-freehand` ist schon installiert.

## 5. Risiken
| Risiko | Gegenmittel |
|---|---|
| Live Preview rendert den Block neu, wenn `text:` geschrieben wird | State liegt im InkStore, Path2D und Bitmap werden gecacht, geschrieben wird nur im Leerlauf |
| Wettlauf zwischen Editor und Vault bei offener Notiz | Editor-API bei offener Notiz, sonst `vault.process`, Block beim Schreiben neu suchen |
| ORT-Glue lädt nicht oder Wasm-Version passt nicht | Spike S1 mit drei Varianten, exakter Pin, abgeleitete URL, SHA-Prüfung |
| Canvas-Speicher bei langen Blöcken | Kacheln à 1024 px, lazy angelegt, ferne Kacheln freigeben |
| LiveSync-Konflikte bei `.ink`-Dateien | Merge per Stroke-ID, Debounce, nie beim Rendern Dateien anlegen |
| Kopierte Blöcke zeigen auf dieselbe Datei | Schreiben auf den nächstgelegenen Treffer und Warnung ausgeben |
| Stift unter Wayland | Erst „Pen diagnostics“, Fallback `--ozone-platform=x11`, Setting „Nur Stift“ |
| OCR-Qualität bei der eigenen Schrift | Eigenes Testset, Strichstärke und Höhe nachjustieren |

## 6. Verifikation
- **Unit-Tests (vitest, `src/**/*.test.ts`):**
  - ink-format: Round-Trip, Quantisierungsfehler ≤ 0,05
  - source/locate: CRLF, `~~~`, mehrere Blöcke, fehlendes `text:`
  - history, merge, hitTest
  - segment: Fixtures mit zwei Zeilen, Umlauten und zwei Spalten
  - ctc mit handgebauten Logits, preprocess-Padding, transform, slug
  - Befehl: `npx vitest run` und `npm run build`
- **Manuell in Obsidian** (Test-Vault, Plugin per Symlink; auf dem Desktop **nur mit der Maus**, mit Stift dann auf dem HP-Gerät):
  - Reading View und Live Preview, Cursor im und außerhalb des Blocks
  - Ctrl+Z im und außerhalb des Blocks
  - Resize, Zoom, Monitorwechsel mit anderer DPR
  - Notiz und `.ink`-Datei umbenennen bzw. löschen
  - PDF aus `_materialien/pdfs` als Hintergrund
  - OCR mit abgeschaltetem Netzwerk
- **LiveSync:** 20 Striche in Schüben erzeugen höchstens 4 Revisionen der `.ink`-Datei. Die .md bekommt nur bei echter Textänderung eine Revision.
- **Lernplattform:** Nach einem Import ist der OCR-Text über die FTS-Suche auffindbar (`src/lib/fts.ts`, keine Code-Änderung nötig).
