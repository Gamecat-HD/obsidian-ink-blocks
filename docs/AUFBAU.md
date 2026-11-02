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

---

## Umsetzungsnotizen (Abweichungen vom Plan)

- **Strg+Z (M3):** Statt eines Obsidian-`Scope` bekommt die Fläche beim Antippen den Fokus (`tabindex=-1`). Ein `keydown`-Listener auf dem Block behandelt Strg+Z / Strg+Umschalt+Z / Strg+Y und stoppt die Propagation, damit CodeMirror nichts davon mitbekommt. Ein Klick außerhalb deaktiviert den Block.
- **Fokus und Re-Render:** Liegen Fokus oder DOM-Auswahl im Widget, während der Blockinhalt geschrieben wird (`bgStyle`, später `text:`), übernimmt CodeMirror die Auswahl, und Live Preview klappt den Block in den Quelltext auf. Deshalb nehmen Toolbar-Buttons keinen Fokus (`preventDefault` auf mousedown), und vor jedem Schreiben wird der Fokus freigegeben (`releaseFocus`).
- **Toolbar-Position:** Obsidians „Block bearbeiten“-Button (`</>`) liegt oben rechts im Codeblock-Widget. Die Leiste sitzt deshalb 44 px weiter links.
- **Store-Cache:** Live Preview gibt beim Re-Render den alten Block frei, *bevor* der neue den Eintrag anfordert. Einträge bleiben deshalb nach der letzten Freigabe noch 10 s im Cache, damit Undo das Re-Render übersteht.
- **Radieren über mehrere Schritte:** Die Erase-Op speichert die Indizes vom Beginn der Geste, damit Undo die ursprüngliche Reihenfolge exakt wiederherstellt.
- **Druck:** Stifte, die durchgehend 0,5 melden (kein Drucksensor), werden wie Maus behandelt (`simulated`).
- **Lazy-Init:** Ein eigener IntersectionObserver vor dem Laden war nicht nötig. Kacheln bekommen ihren Backing-Store erst, wenn sie sichtbar werden. Gemessen: 10 Blöcke × 150 Striche sind nach ca. 75 ms gezeichnet.
- **`bg:`-Format (M4):** `"[[Datei.pdf#page=2]]"`, also Obsidians eigene Link-Syntax mit Seite, kürzester Linktext relativ zur Notiz. Geparst werden auch `![[…|Alias]]`, `[[…]]#page=N` und Links ohne Klammern (`block/bgLink.ts`).
- **Umbenennen von Hintergründen:** Obsidian aktualisiert Links in Codeblöcken nicht. Der InkStore zieht deshalb beim Umbenennen bzw. Verschieben von PDFs/Bildern (und Ordnern) die `bg:`-Felder nach, ebenso `file:`, jeweils nur innerhalb echter ink-Fences.
- **Leeres Heft + `bg:`:** Ein leerer Heft-Block, dem man von Hand ein `bg:` gibt, wird automatisch zum Arbeitsblatt (Größe des Hintergrunds).
- **Rand:** Koordinaten beziehen sich auf die Innenkante der Fläche (`clientLeft/clientTop`). Vorher lag alles um den 1-px-Rahmen versetzt.
- **E2E-Harness:** Der Button „Vertrauen“ im Trust-Dialog von Obsidian 1.14 hinterlässt einen Zustand, in dem keine Modals mehr öffnen. Der Harness schließt den Dialog deshalb per X; die Plugins sind über `setEnable` bereits aktiv.
- **OCR (M5):** Die Lücke für neue Segmente bezieht sich auf die Zeilenhöhe, nicht auf die Strichhöhe. Druckbuchstaben bestehen aus kurzen Strichen, und Wortabstände sollen im Segment bleiben.
- **Re-Aktivierung:** War der Block beim Schreiben von `text:` aktiv, aktiviert sich die neu gerenderte Instanz wieder (`entry.reactivate`), damit Strg+Z weiter auf die Tinte wirkt.
- **Testdaten:** Die E2E-Tests erzeugen „Handschrift“ als echte Pointer-Striche aus Einstrich-Fonts (`hersheytext`, `scripts/e2e/lib/hershey.mjs`). Umlaute setzen sie aus Grundbuchstabe + zwei Punkt-Strichen zusammen.
- **Tesseract (M6):** Das Plugin-Bundle ist CommonJS. esbuild würde ein `import()` der Blob-URL in `require` umschreiben. Deshalb wird die UMD-Variante per `<script>` geladen (`window.Tesseract`). tesseract.js ist nur noch Dev-Abhängigkeit (Tests, `fetch-models`).
- **Fallback nur bei Bedarf:** Eine Engine wird erst geladen, wenn Segmente ohne Cache-Treffer erkannt werden müssen. Ein kaputtes Modell fällt also erst beim nächsten neuen Strich auf.
- **Werkzeugleiste (M7):** Lag die Leiste auf der Fläche, gingen Striche verloren, die unter ihr begannen. Das zeigte die OCR-Messung („255. 55.“). Außerhalb des Blocks lässt sie sich nicht platzieren, denn Obsidians Codeblock-Widget hat `contain: paint`. Lösung: ein reservierter 40-px-Streifen über der Fläche. Bei langen Blöcken klebt die Leiste beim Scrollen oben; während eines Strichs blendet sie aus (`.is-drawing`). Das Ausblenden ist um 400 ms verzögert, damit man vom Block auf die Leiste wechseln kann.
- **Erkannter Text:** Er wird unter der Fläche angezeigt (Einstellung „Erkannten Text anzeigen“). Quelle ist das `text:`-Feld des Blocks. Weil der Block nach jedem Schreiben von `text:` neu gerendert wird, ist die Anzeige automatisch aktuell.
- **Leseansicht:** Der Block funktioniert dort genauso, auch Zeichnen (E2E-getestet).
- **Gleichzeitige Änderungen:** Lokaler, noch nicht gespeicherter Strich plus per Sync geänderte Datei werden zusammengeführt (E2E-getestet).
- **Messung und Debug:** `ocr/benchmark.ts` enthält 30 Sätze (Alphabet von v2 geprüft), CER per Levenshtein-Distanz und einen Bericht als Markdown-Tabelle. Der Debug-Befehl speichert die Segmentbilder nach `<Ordner>/_debug/`.

### Erweiterung nach v0.1.0 (M8)

- **Live-Strich unsichtbar (Bug):** Der Live-Canvas nutzte `getContext("2d", { desynchronized: true })`. Unter Linux/Wayland mit GPU-Compositing (Obsidian des Nutzers) war der Strich erst nach dem Absetzen zu sehen. Headless-Tests merkten das nicht, weil Software-Rendering den Canvas normal komponiert. `desynchronized` ist entfernt.
- **`InkEditor`:** Leiste, Fläche, Eingabe und Hintergrund sind zusammengefasst und werden vom Block und von der ausgeklappten Ansicht genutzt. Jede Ansicht hat ihr eigenes `commit`, das nur die *anderen* Ansichten benachrichtigt (sonst baut sich die gerade benutzte Ansicht nach jedem Strich neu auf). `plugin.editors` ersetzt die Block-Liste für die „wird gerade gezeichnet?“-Prüfung der Texterkennung.
- **Ausklappen:** Ein Obsidian-Modal (96 vw × 94 vh) mit eigener Store-Referenz (der Block kann währenddessen neu gerendert werden) und eigenem Tastatur-Scope für Strg+Z/Y. Die Texterkennung zielt weiter auf den Block in der Notiz.
- **Einbettungen beschriften:** Der Button wird erst beim Überfahren angehängt (Embeds rendern asynchron bzw. als CM-Widgets). Die Zeile kommt in Live Preview über `cm.posAtDOM`, sonst über die erste Zeile mit dieser Einbettung. Die Einbettung wird durch Arbeitsblatt-Blöcke ersetzt (Text davor/danach bleibt als eigene Absätze). Hinweis: Links in Codeblöcken zählt Obsidian nicht als Backlink.

### Erweiterung v0.2.0 (M9–M13)

- **M9 Live-Strich (zweiter Anlauf):** Auch ohne `desynchronized` zeigte der Block auf dem HP-Laptop (Wayland, Stift) den Strich erst nach dem Absetzen, im Pen-Diagnose-Dialog dagegen sofort.
  - Unterschiede: Der Dialog malt synchron im `pointermove` auf einen stabilen, immer sichtbaren Canvas. Der Block malte per `requestAnimationFrame` auf einen eigenen Live-Canvas, der pro Strich von `display:none` auf sichtbar wechselte und neu dimensioniert wurde.
  - Jetzt malt der Block wie der Dialog: synchron, direkt auf die Kacheln, nur im betroffenen Ausschnitt (Clip, gecachter 2D-Kontext, kein Realloc). Die Reihenfolge Textmarker → Live-Textmarker → Stift → Live-Stift hält Markierungen auch live unter der Schrift.
  - `pointsBounds` rechnet mit 0,8 × size (perfect-freehand-Radius bei vollem Druck mit thinning 0.6).
- **M10 iPad-Modus:** Obsidian 1.14 hat `app.emulateMobile(on)`. Das setzt `localStorage.EmulateMobile` und lädt neu; danach gilt `Platform.isMobile` plus `body.emulate-mobile`/`is-mobile`.
  - `isDesktopApp` bleibt true, Desktop-Plugins laden weiter.
  - Vor dem Umschalten werden Notizen, Ink-Dateien, Einstellungen und Layout gesichert.
  - Im Touch-Modus ist die Leiste immer sichtbar (kein Hover) und hat 40-px-Knöpfe.
  - Zum Zurückschalten gibt es einen schwebenden Knopf.
  - E2E m10 lädt zweimal neu.
- **M11 Muster und Breiten:** `model/pattern.ts` (rein, getestet) löst Stil und Abstand je Block auf. Das neue Block-Feld `gap:` überschreibt die Einstellungen; ein Stilwechsel entfernt es wieder.
  - `writeBlockFields` schreibt mehrere Felder in einem Schritt.
  - Breiten: 3 Slots je Werkzeug, Werte in den Einstellungen.
  - `settingsData.ts` (ohne obsidian-Import, testbar) migriert Daten aus v0.1.
  - Obsidian 1.14 kennt `grid-3x3` nicht mehr → Icon `grid`.
- **M12 Textmarker:**
  - Das Lineal ersetzt die Punkte live durch `straightLine` (bis ±8° waagerecht).
  - Die Palette ist hinten erweitert (6–8), damit gespeicherte Indizes stabil bleiben.
  - Auf Arbeitsblättern multiplizieren die Kacheln mit der Seite (`mix-blend-mode: multiply`).
- **M13 Formerkennung (`model/shapes.ts`):** Liegt der Stift 500 ms ruhig (Zittern < 4 CSS-px), wird der Strich geprüft. Ab 30 Doc-Einheiten gibt es:
  - Linie: Abweichung von der Sehne ≤ 8 %, Einrasten bei ±6°.
  - Geschlossene Formen: Ende nahe am Start, Umfang ≥ 1,8 × Diagonale.
    - Ellipse/Kreis: Variationskoeffizient der normierten Radien < 0,07.
    - Dreieck oder Rechteck: Ecken per RDP, fast gerade Ecken fallen weg (auch ein Startpunkt mitten auf einer Kante), Rechteck mit 60–120°-Winkeln, achsparallel bei < 10°.
    - Sonst lockerer Ellipsen-Fallback.
  - Ergebnis: dichte Polylinie mit konstantem Druck, Flag `shape` (`sh:1`). Gerendert ohne Glättung (scharfe Ecken). Formen gehen nicht in die Texterkennung.

### Nach v0.2.0 (M14)

- **Live-Strich mit echtem Wayland-Stiftweg geprüft:** Ein virtueller uinput-Stift geht durch libinput, Hyprland und `tablet_v2` wie der echte. Damit malt schon v0.1 (8dbe5e4) im Block live, auch mit Theme, Plugins und Vim-Modus des echten Vaults und mit aufliegendem Handballen neben der Fläche. Der Fehler „Strich erst nach dem Absetzen“ hängt also an etwas, das nur das echte Gerät hat; M9 malt jetzt wie der Diagnose-Dialog; mit v0.2.1 bestätigt der Nutzer auf dem echten Gerät, dass der Strich live erscheint.
- **Handballen auf der Fläche (Bug, mit virtuellem Touchscreen reproduziert):** Lag die Hand vor dem Stift auf der Fläche, startete sie bei „Nur Stift zeichnet“ eine Scroll-Geste; der Stift wurde dann ignoriert und der Strich ging verloren. Jetzt bricht der Stift eine Touch-Geste ab, Berührungen während bzw. kurz nach dem Schreiben werden ganz ignoriert (kein Scrollen). Dazu `lostpointercapture` wie `pointerup`, eine verwaiste Geste desselben Pointers wird beim nächsten Aufsetzen abgeschlossen.
- **Wachsen ohne Blinken:** Die unterste Kachel wird an Ort und Stelle vergrößert und sofort neu gemalt (vorher neu angelegt und bis zum IntersectionObserver leer). Der Live-Strich wird bei jedem Neuzeichnen einer Kachel mitgemalt.
- **Ausgeklappte Ansicht:** Werkzeugwechsel aktualisiert auch ihre Leiste (`toolsChanged` über `plugin.editors`); das Texterkennungs-Ziel wird beim Ausklappen festgehalten (vorher `null`, sobald der Block in der Notiz neu gerendert war).
- **Zeilenabstand-Regler (`ui/GapPopover.ts`):** Popover statt Dialog, damit die Fläche sichtbar bleibt. Vorschau über `Surface.setPattern`, gespeichert wird erst beim Schließen. Ein eigener `gap:` schreibt `bgStyle:` mit fest.
- **Leiste im iPad-Modus:** `max-width` + Querscrollen statt links abgeschnitten (Textmarker-Modus hat 17 Knöpfe à 40 px).

### v0.3.0 (M15): Beam-Search mit Vault-Sprachmodell

Grundlage ist die Recherche [recherche/OCR-OPTIONEN-2026-10.md](recherche/OCR-OPTIONEN-2026-10.md): Es gibt kein besseres kleines Modell, der größte Hebel ist der Decoder.

- **`ocr/lm.ts`:** Zeichen-n-Gramm-LM, Ordnung 6, mit Witten-Bell-Interpolation.
  - n-Gramme sind als Zahlen kodiert (Alphabet-Code + 1, Basis = Alphabetgröße + 1).
  - Seltene n-Gramme ab Ordnung 3 (Anzahl < 2) werden verworfen.
- **`ocr/corpus.ts`:** Markdown → Klartext.
  - Entfernt werden ink-Blöcke (die OCR-Texte würden sonst Fehler verstärken), Frontmatter, Link-Ziele und Syntax. Code bleibt erhalten.
  - Die OCR-Messnotiz bleibt draußen.
- **`ocr/beam.ts`:** CTC-Prefix-Beam-Search (Breite 16) mit Shallow Fusion α·log P_lm + β je Zeichen.
  - Grammatik für IPv4/IPv6/CIDR: Innerhalb einer Adresse entscheidet ein Zeichensatz statt des LM, fremde Zeichen werden bestraft.
- **Einbindung:**
  - `OcrService` sammelt den Vault-Text (neueste Notizen zuerst, max. 4 M Zeichen) plus die Einstellung „Fachbegriffe“ (20-fach gewichtet).
  - Der Worker baut daraus das LM (Nachricht `decoder`).
  - Vault-Änderungen markieren das LM als veraltet; es wird frühestens nach 10 min neu gebaut.
  - Die Engine-Version bekommt `+lm`, damit beim Umschalten der Zeilen-Cache neu erkannt wird. Ein neu gebautes LM verwirft den Cache nicht.
- **Messung** (`scripts/bench/`): `dump_logits.py` berechnet die v2-Logits der ScaDS-Zeilen im v1-Split von naeyn (Val 567 / Test 601, unbekannte Schreiber). `npm run bench:decoder` vergleicht die Decoder. α/β werden auf Val gewählt, berichtet wird auf Test.

### v0.4.0 (M16–M20): Editor nach GoodNotes-Vorbild

- **M16 Lasso (`model/selection.ts`, `input/Selection.ts`, `ui/SelectionLayer.ts`):**
  - Neue Op `replace` (alte Striche raus, neue mit **neuen IDs** an der Stelle des ersten entfernten). Damit bleiben Striche unveränderlich; Merge, OCR-Cache und Undo funktionieren ohne Sonderfälle.
  - Ein Strich ist ausgewählt, wenn ≥ 60 % seiner Punkte im Lasso liegen.
  - Ausgewählte Striche werden aus den Kacheln genommen (`Surface.setHidden`) und in einer SVG-Ebene gezeigt. Verschieben/Skalieren ist dort nur eine Transformation, festgeschrieben wird beim Loslassen.
  - Zwischenablage `plugin.clipboard` gilt blockübergreifend. Beim Einfügen in eine andere Breite wird mitskaliert, im selben Dokument wird versetzt eingefügt.
  - „In Text umwandeln“ nutzt `OcrService.recognizeStrokes` (ohne Cache, schreibt nichts), „Als Text einfügen“ `BlockWriter.insertAfterBlock`.
- **M17 Radierer:** Präzise Variante (`hitTest.splitStroke`): lange Segmente werden verdichtet, berührte Punkte fallen weg, Reste ab 2 Punkten werden Stücke mit neuen IDs. Die Geste baut am Ende aus dem Stand vor der Geste eine `replace`-Op und wendet sie neu an, damit Redo exakt dieselben Stücke liefert.
- **M18 Abdeckband:** Werkzeug `tape` (Format `"t":"tape"`), immer gerade, Umriss in `render/tape.ts`. Es liegt in einer eigenen SVG-Ebene über den Kacheln, denn auf Arbeitsblättern werden die Kacheln multipliziert und ein Band dort würde gedruckten Text nicht verdecken. Aufgedeckt-Zustand `InkEntry.revealed`, nur pro Sitzung. Tippen (≤ 6 px Bewegung) auf ein Band schaltet um; wird daraus ein Strich, wird normal gezeichnet.
- **M19 Farben/Papier:** `c` darf `#rrggbb` sein (`isInkColor`), eigene Farben je Werkzeug in `settings.customColors` (max. 4). `bgStyle: dots` mit Kästchenmaßen.
- **M20 Gesten/Zoom:** `input/MultiTouch.ts` (Tippen ≤ 400 ms und ≤ 12 px; 2 Finger = Rückgängig, 3 = Wiederholen). Zoom nur in der ausgeklappten Ansicht (Breite × Zoom, Scroll-Anker bleibt unter Fingermitte bzw. Mauszeiger), dort steht die Leiste im Kopf.
- **Formatänderung:** `tape` und Hex-Farben kennen ältere Plugin-Versionen nicht (`decodeInk` wirft) → auf allen Geräten v0.4 installieren. Die Lernplattform (`src/lib/ink.ts`) ist nachgezogen.

### v0.5.0 (M21–M24): Tablets und Schreibtraining (Issue #1)

- **M21 Eingabeprofil (`input/profile.ts`):**
  - Je Gerät in `localStorage` (`ink-blocks-input-profile`: `pen` | `finger`, fehlt = automatisch), nicht in `data.json`. Der Sync würde sonst die Einstellung vom Laptop aufs Tablet tragen.
  - `plugin.penOnly` ersetzt in der Pipeline `settings.penOnly`. Automatisch heißt: Stift schon gesehen (`ink-blocks-pen-seen`) → nur Stift; echte Mobil-App (`Platform.isMobileApp`, nicht die Emulation) ohne Stift → Finger zeichnen; Desktop → altes `settings.penOnly`.
  - Der erste `pointerType: "pen"` setzt den Merker; schaltet das das Verhalten um, gibt es einen Hinweis.
  - Finger-Modus: Kontaktfläche > 40 CSS-px (`PointerEvent.width/height`) = Handballen. Der zweite Finger bricht einen angefangenen Fingerstrich ab (vorhandene Logik in `touchDown`); zwei Finger scrollen bzw. tippen Rückgängig.
  - **Sparmodus** je Gerät (`ink-blocks-ocr-lite`, Vorgabe an in der Mobil-App): v2 int8, kein v1-Zweitmodell.
- **M22 Proben (`training/samples.ts`, `training/SampleStore.ts`):**
  - JSONL unter `<Ink-Ordner>/_training/samples-<Geräte-ID>.jsonl`: Soll-Text (`null` = „kein Text“), Erkennung, Quelle (`dictation`/`review`), Engine-Version, Striche (wie `.ink` codiert), Referenzhöhe, Wort-Kennung `key`.
  - Eine Datei je Gerät, damit gleichzeitiges Sammeln auf Laptop und Tablet keinen Sync-Konflikt erzeugt. Gelesen werden alle; bei gleichem `key` gilt die letzte Probe.
  - Holdout fest nach ID (`fnv1a(id) % 5 === 0`). Holdout-Proben fließen weder ins LM noch in die Wahl der Parameter.
- **M23 Diktat (`ui/TrainingModals.ts`, `training/prompts.ts`):**
  - Eigener `InkEntry` nur im Speicher (Pfad leer); `InkEditor` funktioniert damit unverändert, `store.touch` ignoriert ihn.
  - Vorgaben: 55 % Vault-Wörter (√Häufigkeit), 15 % Fachbegriffe, 15 % Grundstock mit Umlauten/ß, 15 % Zahlen/Adressen. Gewicht × (1 + 4·Fehlerquote) je enthaltenem schwachen Zeichen (`weakChars`, Levenshtein-Rückverfolgung über alle Proben).
  - Die Erkennung läuft nach „Weiter“ im Hintergrund, die nächste Vorgabe erscheint sofort.
- **M24 Überprüfen (`ocr/align.ts`, `training/review.ts`):**
  - Worker: `detail` am Segment liefert Wörter und Alternativen. Die Wörter kommen aus einer erzwungenen CTC-Ausrichtung (Viterbi) des Endtextes auf das Hauptmodell: Zeitschritte je Zeichen, Konfidenz = kleinste Spitzenwahrscheinlichkeit eines Zeichens. Zeitschritt → x im Zeilenbild (`output_stride`) → Doc-Einheiten über die Rastertransformation; Wortgrenzen liegen in der Mitte der Lücke.
  - Striche gehören zu dem Wort, in dessen x-Bereich ihre Box-Mitte liegt. Wort-Alternativen stammen aus den N-Best-Lesarten des Segments mit gleicher Wortzahl.
  - Korrektur → `ocr.fixed[segKey]` im `.ink`. Feste Segmente werden nicht neu erkannt und überstehen Engine-Wechsel; sie fallen weg, sobald sich die Striche des Segments ändern (neuer Schlüssel). Älteren Versionen und der Lernplattform ist das Feld egal.
  - Korrigierte Wörter gehen 10-fach ins LM, bestätigte einfach.
- **Abstimmen (`training/tuning.ts`, Worker-Nachricht `tune`):**
  - Jede Probe geht einmal durch beide Modelle; danach wird je Rasterpunkt (v1-Anteil 0/0,3/0,5/0,7/0,85 × α 4 Werte × β 4 Werte) nur decodiert. 27 Proben × 80 Punkte dauern im E2E-Test etwa 23 s.
  - Gewählt wird auf den Abstimmproben, übernommen nur bei weniger Fehlern UND nicht schlechterem Holdout. Die Werte stehen in `settings.ocrTuned` (gelten für den Schreiber, deshalb synchronisiert).
  - `scripts/bench/real.mjs --training <Vault>/_ink/_training` misst zusätzlich auf den gesammelten Proben.
- **Bewusst noch nicht umgesetzt: Kopf-Training** (eigener CTC-Ausgabelayer in TS, siehe Recherche Nr. 6). Es braucht erst echte Proben (30–50+ Zeilen) und einen einmalig um einen Feature-Ausgang erweiterten ONNX-Graphen. Proben, Holdout und die Worker-Schnittstelle dafür sind jetzt vorhanden; wenn das Abstimmen mit genug Proben nichts mehr bringt, ist das der nächste Schritt.

### Nach v0.5.0 (M25): Schreibfläche löschen

- Mülleimer in der Leiste des Blocks (nicht in der ausgeklappten Ansicht). Leere Fläche → sofort, sonst `ui/ConfirmDeleteModal.ts`.
- Ablauf (`InkBlockChild.deleteBlock`): erst `countBlocksUsing` über alle Notizen (offene in ihrer Editor-Fassung), dann `removeBlock` (offene Notiz über den Editor, also Undo-fähig; sonst `vault.process`). Mitentfernt wird eine angrenzende Leerzeile, wenn der Block zwischen Leerzeilen bzw. am Rand steht (`locate.fenceRemovalLines`).
- Nur wenn kein anderer Block die Datei nutzt: `InkStore.discard` (bricht ein ausstehendes Speichern ab, das die Datei sonst neu anlegen würde) und `fileManager.trashFile` (beachtet die Papierkorb-Einstellung von Obsidian).

### Nach v0.5.1 (M26): Kein Strich-Sprung, wenn die Fläche verrutscht

- Beobachtet in echten Proben (Diktat): Fläche 260 hoch, ab y = 140 wächst sie um `GROW_STEP`; der zentrierte Dialog wird höher und rutscht nach oben. Der Stift steht still, `toDoc` liefert plötzlich ~110–120 Einheiten weiter unten – der Strich zog eine lange senkrechte Linie (alle vier Sprünge in den Proben starten bei y = 140–149).
- `PointerPipeline`: Zeichnen und Radieren merken sich die Bildschirmlage der Fläche (`Surface.screenOrigin`). Verschiebt sie sich zwischen zwei Punkten um mehr als 1 CSS-px (Wachsen + Neuzentrieren, Scrollen der Notiz, Layoutwechsel), endet der Strich dort und ein neuer beginnt an der neuen Stelle; der Radierer überspringt den Sprung.
- Schreibtraining-Dialoge sind oben verankert (`align-self: flex-start`), wachsen also nach unten statt sich neu zu zentrieren.

### Nach M26 (M27): Notiz springt nicht mehr nach oben

- Beobachtet auf dem Tablet: Beim Schreiben sprang die Notiz manchmal ganz nach oben, zeitgleich mit dem Eintragen des erkannten Textes (`text:`) in einen Block. Wer nur mit dem Stift arbeitet, lässt die Schreibmarke von CodeMirror am Notizanfang stehen; eine Änderung über `editor.replaceRange` holte sie offenbar ins Bild.
- `BlockWriter.replaceQuietly`: Änderungen an offenen Notizen (Felder, Text unter dem Block) gehen direkt an CodeMirror (`editor.cm.dispatch`, ohne `scrollIntoView`, Undo bleibt). `holdView` merkt sich davor die Lage der aktiven bzw. ersten sichtbaren Schreibfläche und schiebt die Ansicht nach dem Neuzeichnen (2 Frames, nochmals nach 300 ms) zurück, falls sie verrutscht ist – außer der Nutzer scrollt inzwischen selbst.
