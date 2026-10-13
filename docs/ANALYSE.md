# Technische Bewertung: Handschrift-Plugin für Obsidian

Stand: 2026-10-13. Ziel ist, in normalen Notizen mit dem Stift zu schreiben und Arbeitsblätter (PDF/Bild) per Hand auszufüllen, beides **inline** in der Notiz. Die Handschrift soll per lokaler, kostenloser Texterkennung durchsuchbar werden, im Vault und in der Lernplattform.

Verwandte Dokumente: [HARDWARE.md](HARDWARE.md) (HP-Laptop und HP 700 Multi Pen), [RECOGNITION.md](RECOGNITION.md) (OCR).

---

## 1. Fazit

**Machbar, mittlerer Aufwand.** Der Kern ist ein Canvas mit Pointer Events und [perfect-freehand](https://github.com/steveruizok/perfect-freehand) (MIT), eingebettet über einen `ink`-Codeblock mit Sidecar-Datei. Ein gutes MVP umfasst geschätzt 1,5–3k LOC TypeScript.

| Risiko | Einschätzung |
|---|---|
| Stifteingabe/Druck unter Wayland in Electron | **hoch.** Muss vor allem anderen auf der Zielhardware getestet werden (`Pen diagnostics`) |
| Konflikte mit dem Editor (Live Preview fängt Klicks, Ctrl+Z, Touch-Scroll) | mittel, mit bekannten Gegenmitteln |
| Schreiblast über LiveSync | gering, wenn debounced und kompakt gespeichert wird |
| Qualität der Texterkennung | mittel. Modell ist neu, muss mit eigener Schrift getestet werden |

**Marktlücke:** Es gibt Plugins für Inline-Ink und für Stift auf PDF. Keins kombiniert *Inline-Block + PDF-Seite als Hintergrund + lokale Texterkennung*.

---

## 2. Bestehende Plugins

| Plugin | Inline | Speicherung | Technik | Arbeitsblatt | Bemerkung |
|---|---|---|---|---|---|
| [Ink](https://github.com/daledesilva/obsidian_ink) (daledesilva) | ja | eigene Dateien (tldraw-JSON) | tldraw | nein | ca. 1,4k ★, 82 offene Issues, **CC BY-NC-ND**: kein Fork erlaubt. Bug „Zeichnung weg nach Reload“ (#125) |
| [Inline Handwriting](https://community.obsidian.md/plugins/inline-handwriting-puria) (puria) | ja | SVG im Vault | ? | ? | konzeptionell am nächsten dran, Repo war nicht erreichbar |
| [Excalidraw](https://github.com/zsviczian/obsidian-excalidraw-plugin) | Embed | `.excalidraw.md` | Excalidraw | nur Bild einfügen | mächtig, aber ein Whiteboard statt Heft, schwer |
| [tldraw-in-obsidian](https://github.com/holxsam/tldraw-in-obsidian) | Embed | Markdown | tldraw | ? | Lizenz von tldraw beachten (s. u.) |
| [Inkling](https://www.obsidianstats.com/plugins/inkling), [Handwriting Natively](https://www.obsidianstats.com/plugins/native-pdf-handwriting), [Freedraw PDF](https://www.obsidianstats.com/plugins/freedraw-pdf) | nein | in der PDF bzw. Sidecar | ? | **ja** | nur in der PDF-Ansicht, nicht in der Notiz |
| [PDF++](https://github.com/RyotaUshio/obsidian-pdf-plus), [Annotator](https://github.com/elias-sundqvist/obsidian-annotator) | nein | Links/Highlights | – | kein Freihand | keine Lösung |

Alle gefundenen OCR-Plugins für Handschrift ([Handwriting OCR](https://github.com/ikmolbo/handwriting-ocr-obsidian-plugin), Khattat, Tegaki, Garda …) setzen auf **Cloud-Dienste**. Ein Plugin mit Erkennung auf dem Gerät gibt es nicht.

---

## 3. Architektur

### 3.1 Einbettung: Codeblock + Sidecar

````markdown
```ink
file: _ink/2026-10-13-subnetting-a1b2.ink
bg: "[[_materialien/pdfs/Arbeitsblatt.pdf]]#page=2"
height: 600
text: |
  2001:db8::/32 → 65536 /48-Netze
```
````

- [`registerMarkdownCodeBlockProcessor`](https://docs.obsidian.md/Reference/TypeScript+API/Plugin/registerMarkdownCodeBlockProcessor) rendert in Reading View **und** in Live Preview, solange der Cursor nicht im Block steht. Für das MVP ist deshalb keine eigene CM6-Extension nötig.
- **Falle:** Ein Klick in den Block setzt den Editor-Cursor hinein, und Live Preview zeigt dann den Quelltext. Gegenmittel: am Container `pointerdown`/`mousedown` per `stopPropagation()` abfangen.
- **Lebenszyklus:** `ctx.addChild(new MarkdownRenderChild(el))`, Canvas und Worker in `onunload` abbauen. Der Container hängt beim Aufruf eventuell noch nicht im DOM ([Forum](https://forum.obsidian.md/t/callback-when-markdown-code-block-and-editor-is-fully-loaded/64582)).
- **Später optional:** ein CM6-Block-Widget aus einem `StateField` ([Decorations](https://docs.obsidian.md/Plugins/Editor/Decorations)). Block-Decorations aus einem ViewPlugin werfen einen `RangeError`. `WidgetType.eq()` vergleicht die Datei-ID, damit der Canvas nicht bei jedem Tastendruck neu gebaut wird. `ignoreEvent()` sorgt dafür, dass der Canvas die Pointer-Events behält.
- Ein Command „Schreibfläche einfügen“ legt `_ink/<id>.ink` an und fügt den Block an der Cursorposition ein.

### 3.2 Datenformat `.ink` (JSON)

- `{ version, width, background?, strokes: [{ tool, color, size, points: [[x, y, p], …] }] }`
- Koordinaten **normalisiert auf die Blockbreite**, bei PDF-Hintergrund in **PDF-Punkten** der Seite. Damit stimmt die Lage bei jeder Fensterbreite und jeder Zoomstufe.
- Kompakt speichern: Integer quantisieren, Deltas bilden.
- Gespeichert wird debounced (1–2 s nach dem letzten Strich) über `vault.process()`. Grund: **LiveSync** legt jede Speicherung als Revision in CouchDB ab.
- Warum Sidecar statt Base64 in der Notiz: Die Notiz bleibt lesbar, es gibt weniger LiveSync-Konflikte im Notiztext, und Suchindizes werden nicht mit Datenmüll gefüllt.
- Optional eine `.svg`-Vorschau daneben schreiben, für die Lernplattform und für Exporte.

### 3.3 Eingabe und Rendering

- **[Pointer Events](https://developer.mozilla.org/en-US/docs/Web/API/PointerEvent):** `pointerType === "pen"`, `pressure`, `tiltX/Y`, `setPointerCapture`, `touch-action: none` auf dem Canvas.
- **[`getCoalescedEvents()`](https://developer.mozilla.org/en-US/docs/Web/API/PointerEvent/getCoalescedEvents)** ist unverzichtbar für glatte Linien, weil sonst Zwischenpunkte fehlen.
- **Radierer-Ende** über `buttons & 32`, **Seitentaste** über `buttons & 2`. Auf der Hardware prüfen.
- **Palm Rejection:** `touch` ignorieren, solange ein Stift aktiv ist. Option „Nur Stift zeichnet“: Touch scrollt dann die Notiz.
- **Glättung:** perfect-freehand `getStroke(points, { simulatePressure: false })` bei echtem Druck. Das Umriss-Polygon wird als `Path2D` gefüllt.
- **Zwei Canvas-Layer:**
  - fertige Striche als gecachte Bitmap
  - aktiver Strich auf einem eigenen Layer mit `getContext("2d", { desynchronized: true })` für geringere Latenz
- **Viele Blöcke pro Notiz:** Initialisierung erst per `IntersectionObserver`, bis dahin statische Vorschau.
- **Undo/Redo:** eigener Stack. `Ctrl+Z` nur abfangen, solange der Block den Fokus hat.
- **Bewusst nicht verwendet:**
  - tldraw: Seit SDK 4 braucht es einen Lizenzschlüssel, sonst bleibt das Wasserzeichen ([Lizenz](https://tldraw.dev/legal/tldraw-license))
  - Excalidraw: zu schwer, anderes Bedienkonzept

### 3.4 Arbeitsblatt-Modus

- `loadPdfJs()` aus der Obsidian-API liefert das **mitgelieferte pdf.js**, ein eigenes Bündeln entfällt. Die PDF wird über `vault.readBinary()` geladen, die Seite auf einen Hintergrund-Canvas gerendert, skaliert mit `devicePixelRatio`, damit sie nicht unscharf wird ([Forum](https://forum.obsidian.md/t/blurry-pdfs/66289/5)).
- Ein Block entspricht einer Seite (`#page=N`). Mehrseitige Blöcke kommen später.
- Bilder als Hintergrund über `drawImage`.
- Export (Phase 4): Mit `pdf-lib` die Striche als Vektorpfade in eine Kopie der PDF einbrennen, zum Abgeben oder Drucken.

### 3.5 Texterkennung → siehe [RECOGNITION.md](RECOGNITION.md)

Lokal im Plugin (ONNX/WASM) mit der Kette `de-htr-web-v2 → de-htr-web v1 → Tesseract.js`. Das Ergebnis landet im Feld `text:` des Blocks.

### 3.6 Mobile

`isDesktopOnly: false` bleibt gesetzt, Node- und Electron-APIs werden konsequent vermieden. Damit bleibt der Weg zu iPad oder Android offen. Bekannte Hürde auf iPad: Scribble frisst Pencil-Events ([WebKit 217430](https://developer.apple.com/forums/thread/662874)).

---

## 4. Plattform: Linux/Wayland

- Unter Hyprland läuft Electron 43 standardmäßig nativ auf Wayland.
- Chromium hat 2025 Support für `tablet_v2` bekommen. Trotzdem gibt es mehrere Berichte über Probleme:
  - [Arch BBS](https://bbs.archlinux.org/viewtopic.php?id=299709): Stift bewegt den Cursor, zeichnet aber nicht.
  - [CachyOS, 08/2026, Electron 42](https://discuss.cachyos.org/t/bug-mouse-clicks-ignored-in-chromium-electron-native-wayland-after-using-a-tablet-stylus/33714): Nach Stiftnutzung ignoriert die App Mausklicks.
- **Fallback ohne Code-Änderung:** `--ozone-platform=x11` in `~/.config/obsidian/user-flags.conf`. Der Arch-Launcher reicht den Inhalt über `$OBSIDIAN_USER_FLAGS` weiter.
- Unter XWayland können Neigung und Rotation fehlen ([KWin MR 3364](https://invent.kde.org/plasma/kwin/-/merge_requests/3364)). Druck sollte ankommen.

---

## 5. Roadmap

| Phase | Inhalt | Aufwand (Hobby) |
|---|---|---|
| 0 Spike | `Pen diagnostics` auf dem HP-Gerät, Wayland vs. X11 → [HARDWARE.md](HARDWARE.md) | 1 Abend |
| 1 MVP | `ink`-Block, Canvas, Stift/Radierer/Undo, Sidecar mit Debounce, Insert-Command | 2–3 Wochenenden |
| 2 Arbeitsblatt | `bg:` mit PDF-Seite/Bild über `loadPdfJs`, Koordinaten in PDF-Punkten | 1–2 Wochenenden |
| 3 Erkennung | Zeilensegmentierung, de-htr-web-v2 im Worker, `text:`-Feld | 1–2 Wochenenden |
| 3b Lernplattform | `language-ink`-Renderer mit SVG-Vorschau (im Lernplattform-Repo) | 1 Abend |
| 4 Politur | Vorschau/Lazy-Init, Textmarker, Lasso, Linien/Raster, PDF-Export, CM6-Widget | offen |
