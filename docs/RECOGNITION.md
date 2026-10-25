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

**Recherche 2026-10-17:** [recherche/OCR-OPTIONEN-2026-10.md](recherche/OCR-OPTIONEN-2026-10.md) (Notizen in `recherche/notizen/`). Ergebnis: Es gibt kein besseres kleines Modell. Der größte Hebel ist der Decoder (siehe M15 unten). Danach folgen Render-Tuning und PP-OCRv6 statt Tesseract.js.

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

## Umsetzung (M5) und Messwerte

- **Ablauf:**
  1. Nach einer Änderung wartet das Plugin die Ruhepause ab (Einstellung, Standard 10 s).
  2. `segment.ts` teilt die Striche in Zeilen und Segmente.
  3. Nur Segmente ohne Cache-Eintrag gehen in den Worker. Dort werden sie gerastert (`preprocess.ts`) und mit onnxruntime-web erkannt (`ctc.ts`).
  4. Der Text wird zusammengesetzt und, falls geändert, über den `BlockWriter` ins `text:`-Feld geschrieben.
- **Cache:** `doc.ocr.lines` (Segment-Key → Text) wird mit der `.ink`-Datei gespeichert. Wechselt die Modellversion (`engine`), wird er verworfen.
- **Schutz für eigenen Text:** `doc.ocr.written` ist der Hash des zuletzt von uns geschriebenen Textes. Weicht `text:` davon ab und ist nicht leer, bleibt der Text stehen. Nur der Befehl „Handschrift in dieser Notiz erkennen“ überschreibt ihn dann.
- **Segmentierung:** Der Zeilenabstand richtet sich nach der typischen Strichhöhe. Eine neue Spalte bzw. ein neues Antwortfeld beginnt bei einer Lücke über 1,5 Zeilenhöhen. Zu breite Segmente (Seitenverhältnis > 16, das ist die Modellgrenze 1024 × 64) werden an der größten Lücke nahe der Mitte geteilt. Die Segmente einer Zeile werden mit Leerzeichen verbunden.
- **Worker:** esbuild baut `src/ocr/worker.ts` separat und bindet ihn als String ein (`virtual:ocr-worker`, ca. 72 KB). Zur Laufzeit läuft er als Blob-Modul-Worker. `wasmBinary`, Modell und Config werden einmal pro Engine übergeben.
- **Downloads:**
  - Hugging-Face-URLs auf feste Commits gepinnt (v2 `6241c1ff…`, v1 `8b0350cc…`).
  - Wasm von jsDelivr in exakt der gebündelten onnxruntime-web-Version.
  - SHA-256 wird vor dem Schreiben geprüft, Ziel ist `<plugin>/models/`. Ein Download startet nur auf Knopfdruck (Einstellungen oder Befehl).

**Gemessen** (E2E, synthetische Striche aus Einstrich-Fonts, Electron 43, single-threaded Wasm):

| Eingabe (EMSReadability) | Erkannt |
|---|---|
| Hallo Welt | Hallo Welt |
| Subnetzmaske 255.255.255.0 | Subnetzmaske 255.255.255.0 |
| Übung für Größe (ß als „ss“ gezeichnet) | Übuns für Grösse |
| 2001:db8::1 | 2007:db8:: I |

- Dauer: ca. 1 s pro Zeile. Zwei Zeilen standen ca. 4 s nach dem letzten Strich im Block (1 s Ruhepause + Laden + Inferenz).
- Schreibschrift-ähnliche Fonts (EMSAllure, HersheyScript) werden schlechter erkannt („Jtalla Welt“), Ziffernfolgen dagegen gut.
- **Echte Handschrift muss noch auf dem HP-Gerät gemessen werden** (M7: CER auf 30 eigenen Zeilen).

## Fallback-Kette (M6)

- **Einstellung „Erkennungs-Engine“:** *Automatisch* (Standard) versucht de-htr-web-v2, dann v1, dann Tesseract.js. Genommen wird die erste Engine, deren Dateien vollständig vorliegen und die in dieser Sitzung nicht gescheitert ist. Scheitert eine Engine beim Laden oder Erkennen (z. B. beschädigte Datei), kommt sofort die nächste dran, mit Hinweis („… nicht verfügbar – nutze …“). Wählt man eine Engine manuell, gibt es keinen Fallback: Fehlt sie, erscheint ein Hinweis, und der Text bleibt unverändert.
- **Cache je Engine-Version:** Ein Wechsel der Engine erkennt alle Segmente neu. Gültige Cache-Treffer werden weiterverwendet, die Engine wird dann gar nicht erst geladen.
- **Tesseract.js wird nicht gebündelt:**
  - Wie die Modelle wird es auf Knopfdruck geladen (gepinnte jsDelivr-Versionen, SHA-256): `tesseract.min.js` (UMD, per `<script>` aus einer Blob-URL), `worker.min.js` und `tesseract-core-simd-lstm.wasm.js` (Blob-URLs), dazu `deu.traineddata.gz` (`@tesseract.js-data/deu@1.0.0`, best_int) über die Ressourcen-URL des Modellordners. Zusammen ca. 5 MB.
  - Seitensegmentierung 7 (eine Zeile). Gerastert wird auf 96 px Höhe, auf dem Hauptthread; Tesseract erkennt in seinem eigenen Worker.
- **Gemessen (E2E, EMSReadability-Striche):**

| Engine | Ergebnis |
|---|---|
| v2 | „Hallo Welt“ |
| v1 | „Hall0 Welt / Netz“ |
| Tesseract | „Hallo Welt / Netz / Maske“ |

Tesseract kommt mit dieser sehr gleichmäßigen Druckschrift gut zurecht. Bei echter Handschrift ist es laut Benchmark deutlich schwächer (CER ca. 43 %).

## Beam-Search mit Vault-Sprachmodell (M15)

Statt greedy dekodiert der Worker per CTC-Prefix-Beam-Search mit einem Zeichen-6-Gramm aus dem eigenen Vault. Dazu kommt eine Grammatik für IP-Adressen. Einstellung: „Sprachmodell aus dem Vault“, Standard an; dazu optional „Fachbegriffe“. Aufbau siehe [AUFBAU.md](AUFBAU.md#v030-m15-beam-search-mit-vault-sprachmodell).

**Gemessen auf echter Handschrift:** ScaDS.AI-Zeilen unbekannter Schreiber (Split von naeyn/de-htr-web), v2 int8. α/β wurden auf 567 Val-Zeilen gewählt (Ergebnis α = 0,35, β = 1,5). Die Werte gelten für die 601 Test-Zeilen:

| Decoder | LM-Text | CER | WER |
|---|---|---:|---:|
| greedy (bisher) | – | 8,14 % | 33,1 % |
| Beam, ohne LM | – | 8,11 % | 32,9 % |
| Beam + LM | eigener Vault (0,8 M Zeichen, IT-Notizen, **fachfremd**) | **6,97 %** | **27,1 %** |
| Beam + LM | ScaDS-Train-Sätze (0,2 M Zeichen, gleiche Textsorte wie der Test) | 6,73 % | 25,7 % |
| Beam + LM | Vault + ScaDS-Train (α = 0,5, β = 2,5) | 6,46 % | 24,4 % |

- Die Testsätze sind Wikipedia-Text, das LM aus den Berufsschul-Notizen passt also nicht zum Thema. Trotzdem sinkt die CER um 14 % relativ. Auf eigenen Notizen, wo LM und Text zusammenpassen, sollte der Gewinn größer sein.
- Ordnung 7 bringt gegenüber 6 nichts mehr. Je besser das LM zum Text passt, desto höher fallen α/β aus. Deshalb sollten α/β später auf den eigenen Korrekturen nachjustiert werden.
- Dauer: ca. 4 ms pro Zeile für die Dekodierung (Node). Das LM-Bauen kostet ca. 0,7 s pro 0,8 M Zeichen, einmal pro Sitzung bzw. nach Vault-Änderungen.

**E2E** (`m15-decoder`, synthetische Striche aus EMSReadability/EMSAllure, LM aus einer Fachnotiz im Test-Vault): CER 9,9 % → 7,3 %. Beispiele: „Der Roliterleitet Pakete Weiter.“ → „Der Roliter leitet Pakete weiter.“; „Schicht B ist de …“ → „… ist die …“.

**Nachtrag 2026-10-25:** Die Messung auf eigener Stiftschrift liegt jetzt vor (siehe nächster Abschnitt). Render-Tuning hat sich als wirkungslos erwiesen.

## Ensemble v2 + v1, fp32, Rauschen (v0.4.1, 2026-10-25)

**Messbasis:**
- **Eigene Stiftschrift:** 7 Proben (HP 700 Multi Pen, 15 Zeilenstücke, 186 Zeichen) mit Soll-Text in `scripts/bench/real/`. `node scripts/bench/real.mjs --vault <Vault>` lässt die echte Pipeline in der isolierten Obsidian-Instanz laufen. Das LM wird dabei aus den Markdown-Dateien des Vaults gebaut, ohne `.obsidian`, damit LiveSync nicht anläuft.
- **Fremde Schreiber:** 150 ScaDS-Testzeilen (writer-disjoint). `scripts/bench/scads.mjs` binarisiert und skelettiert sie (Zhang-Suen) und schickt die Skelettpixel als Striche durch dieselbe Rasterung wie Stiftstriche. Damit ist die Domäne „Stiftspur → Zeilenbild“ nachgestellt. Die Absolutwerte liegen höher als auf den Originalscans, weil die echte Strichbreite fehlt; für Vergleiche zwischen Varianten taugt das.
- Zum Anschauen der Modelleingaben: `scripts/bench/real-images.mjs`.

**Ergebnisse:**

| Variante | eigene Schrift (CER) | ScaDS-Skelett, ohne LM (CER) | Zeit eigene Proben |
|---|---:|---:|---:|
| v2 int8 + LM (bisher) | 19,4 % | 14,2 % | 8,8 s |
| v2 fp32 + LM | 19,4 % | – | 2,4 s |
| v1 + LM | 16,1 % | 13,3 % | 2,4 s |
| **v2 fp32 + v1, Rescoring w = 0,7, + LM (neu)** | **16,7 %** | **12,0 %** | 4,0 s |
| dasselbe, w = 0,5 / 0,6 / 0,8 / 0,9 | 16,7 / 16,1 / 17,2 / – % | 12,4 / 12,2 / 12,2 / 12,3 % | |

Dazu E2E `m15-decoder` (synthetisch): 7,3 % → 5,2 % CER.

**Was das Ensemble macht:** Beide Modelle sehen dasselbe Zeilenbild. Jedes liefert seine 8 besten Kandidaten (Beam + LM). Jeder Kandidat bekommt (1−w)·log P_v2 + w·log P_v1 + α·log P_lm + β·|Text|. P ist dabei die volle CTC-Wahrscheinlichkeit, also die Summe über alle Ausrichtungen (`ctcLogLikelihood`). Das Mischen der Wahrscheinlichkeiten je Zeitschritt wurde verworfen: Die Modelle setzen ihre CTC-Spitzen zu verschiedenen Zeitpunkten, dadurch gingen ganze Zeichen verloren (ohne LM 29,6 % CER, typisch der erste Buchstabe: „ie Übung“). v1 wird auf das v2-Alphabet abgebildet; Zeichen, die nur v1 kennt, fallen weg.
- Aktiv nur bei Engine „Automatisch“ und wenn v1 geladen ist. v2 wird als fp32 genutzt, sobald `model-fp32.onnx` (40 MB, derselbe Commit) da ist. int8 ist in onnxruntime-web/Wasm 3–4× langsamer und nicht genauer.
- v1 erkennt die eigene Stiftschrift besser als v2. Vermutlich, weil v2 stärker auf die ScaDS-Scans hin trainiert ist. Das Ensemble ist auf fremden Schreibern klar besser als beide Modelle allein und auf der eigenen Schrift so gut wie v1.

**Ohne Gewinn gemessen und wieder entfernt:**
- Strichbreite 1,6/2,0/3,4 px statt 2,6 px: auf ScaDS war 2,0 px um 0,4 Punkte besser, auf der eigenen Schrift gleich bzw. schlechter.
- Test-Time-Augmentation über mehrere Strichbreiten bzw. über Scherungen ±8–10°: schlechter.
- Begradigen (Hauptachse) und Kursiv-Aufrichten: Die „schräg“-Probe ist kursiv, nicht gedreht. Aufrichten machte es schlechter.
- Glätten der Punkte und Binarisieren.
- α/β-Variationen: auf 7 Proben im Rauschen (±2 Fehler).

**Behoben:**
- Ein versehentlicher Tupfer weit unter einer Zeile wurde ihr zugeschlagen und hat die Zeile beim Rastern auf die halbe Höhe gestaucht. Kleine Striche weiter als eine Zeilenhöhe von jeder Zeile entfernt werden jetzt ignoriert (`segment.ts`, `STRAY_FACTOR`).
- War `text:` von Hand geändert, blieb der Text beim Weiterschreiben still veraltet. Jetzt zeigt der Block „Text von Hand geändert …“ mit dem Knopf „Neue Erkennung übernehmen“ (`InkEntry.ocrPending`).

**Offen:**
- Mehr eigene Proben: Die 7 Proben reichen nur für grobe Entscheidungen, ein Zeichen sind 0,5 Punkte.
- Typische Restfehler: Wortlücken („begintum“), das eigene „t“ wird zu „l“, IPv6-Doppelpunkte, die „5“.
- Ideen: Personalisierung über Korrekturen (Hotwords, Konfusions-Prior), Wort-Konfidenz.
