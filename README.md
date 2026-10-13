# Ink Blocks (Obsidian-Plugin)

Mit dem Stift **direkt in normalen Notizen** schreiben und **Arbeitsblätter** (PDF-Seiten/Bilder) per Hand ausfüllen. Die Handschrift wird **lokal und kostenlos** in Text umgewandelt, damit der Vault und die Lernplattform sie durchsuchen können.

> Status: **v0.1.0 – Phase 1–3 umgesetzt (M1–M7)**: Schreibflächen, Arbeitsblätter, lokale Texterkennung mit Ausweich-Engines. Getestet in einer echten Obsidian-Instanz (E2E) mit Maus und simuliertem Stift. **Auf echter Stift-Hardware noch nicht erprobt** → [docs/HARDWARE.md](docs/HARDWARE.md).

## Bedienung

| Befehl (Strg+P) | Wirkung |
|---|---|
| **Schreibfläche einfügen** | Neue Heft-Fläche an der Cursorposition (volle Breite, wächst beim Schreiben nach unten) |
| **Arbeitsblatt einfügen (PDF/Bild)** | PDF/Bild aus dem Vault wählen, bei PDFs eine Seite oder alle → je Seite eine Fläche mit der Seite als Hintergrund |
| **Bild/PDF in dieser Zeile beschriftbar machen** | Ersetzt ein eingebettetes `![[bild.png]]`/`![[blatt.pdf]]` der Zeile durch beschriftbare Arbeitsblatt-Flächen (alternativ: Button „Beschriften“ beim Überfahren der Einbettung) |
| **Handschrift in dieser Notiz erkennen** | Sofort erkennen (überschreibt auch selbst bearbeiteten `text:`) |
| **Texterkennung: Modelle herunterladen** | Einmaliger Download des Erkennungsmodells (siehe unten) |
| **OCR-Messung: Notiz mit 30 Testsätzen anlegen** / **auswerten** | Erkennungsqualität mit der eigenen Handschrift messen (Zeichenfehlerrate) |
| **OCR-Debug: Segmentbilder dieser Notiz speichern** | Zeigt, wie das Modell die Handschrift „sieht“ (Bilder + erkannter Text) |
| **Verwaiste Ink-Dateien finden** | `.ink`-Dateien ohne Block auflisten und auf Wunsch in den Papierkorb legen |
| **Pen diagnostics** | Stift testen: Druck, Neigung, Radierer, Event-Rate |

**In der Fläche:**
- Mit Stift oder Maus schreiben.
- Radieren über das Radierer-Werkzeug, das Radierer-Ende oder die Seitentaste des Stifts.
- Finger scrollen (Einstellung „Nur Stift zeichnet“).
- **Ausklappen** (Button ⤢ in der Leiste): öffnet dieselbe Fläche groß im Fenster, wie hineingezoomt. Ideal zum bequemen Schreiben und zum Ausfüllen von Arbeitsblättern. Esc oder ⤡ klappt wieder ein; alles landet sofort im Block.
- **Eingebettete Bilder/PDFs:** Beim Überfahren erscheint „Beschriften“. Ein Klick macht daraus Arbeitsblatt-Flächen mit dem Bild bzw. der PDF-Seite als Hintergrund (bei PDFs Seite oder alle Seiten wählbar).
- Die **Werkzeugleiste** erscheint über der Fläche, wenn man mit Maus oder Stift darüberfährt bzw. sobald der Block aktiv ist. Sie bietet Stift, Textmarker, Radierer, 3 Farben, 2 Breiten, Rückgängig/Wiederholen und den Hintergrund (liniert, kariert, leer).
- **Strg+Z / Strg+Umschalt+Z / Strg+Y** wirken auf die Tinte, solange der Block aktiv ist, also nach dem Antippen. Ein Klick in den Text gibt die Tasten wieder an den Editor.
- Der **erkannte Text** steht dezent unter der Fläche (Klick klappt ihn auf) und im Feld `text:` des Blocks. Darüber finden ihn die Obsidian-Suche, Omnisearch und die Lernplattform.

**Block-Syntax:**

````markdown
```ink
file: _ink/2026-10-13-notiz-a1b2.ink
bg: "[[Arbeitsblatt.pdf#page=2]]"
bgStyle: grid
text: |
  erkannter Text
```
````

**Installation (manuell):** Nach `npm run build` die Dateien `main.js`, `manifest.json` und `styles.css` nach `<vault>/.obsidian/plugins/obsidian-ink-blocks/` kopieren und das Plugin unter Einstellungen → Community-Plugins aktivieren. Danach unter Einstellungen → Ink Blocks das Erkennungsmodell herunterladen.

## Dokumentation

- [docs/ANALYSE.md](docs/ANALYSE.md): technische Bewertung, Architektur, Roadmap
- [docs/HARDWARE.md](docs/HARDWARE.md): HP-Laptop + HP 700 Multi Pen unter Linux/Hyprland, Testprotokoll
- [docs/RECOGNITION.md](docs/RECOGNITION.md): lokale Texterkennung (de-htr-web-v2 → v1 → Tesseract.js), Anbindung an die Suche
- [docs/AUFBAU.md](docs/AUFBAU.md): Implementierungsplan Phase 1–3 (Module, Datenformat, Algorithmen, Meilensteine M1–M7)
- [docs/SPIKES.md](docs/SPIKES.md): Ergebnisse der Machbarkeitstests (ORT im Worker, pdf.js, Tesseract offline, Live-Preview-Re-Render)
- Abweichungen vom Plan und Erkenntnisse aus der Umsetzung: [docs/AUFBAU.md](docs/AUFBAU.md) → „Umsetzungsnotizen“

## Entwicklung

```sh
npm install
npm run dev     # esbuild watch → main.js
npm run build   # Typecheck + Production-Build
npm test        # Unit-Tests (vitest) für die Obsidian-freien Module
npm run fetch-models          # OCR-Modelle für Spikes/E2E nach models/ laden
npm run e2e -- scripts/e2e/tests/*.mjs   # E2E in echtem Obsidian (s. u.)
```

### E2E-Tests

`scripts/e2e/harness.mjs` startet eine **isolierte, headless** Obsidian-Instanz (eigener `XDG_CONFIG_HOME`, frische Kopie von `test-vault/`, Plugin aus dem Repo) und steuert sie per Chrome DevTools Protocol. Eine laufende Obsidian-Instanz bleibt unberührt. Voraussetzung: Arch-Paket `obsidian` (`electron43`, `/usr/lib/obsidian/app.asar`). Screenshots landen in `e2e-out/`; `--keep` behält den Test-Vault.

## Netzwerk und Datenschutz

- Das Plugin sendet **keine** Notiz- oder Handschriftdaten irgendwohin. Die Texterkennung läuft lokal (onnxruntime-web/Wasm in einem Worker).
- **Einmaliger Download, nur auf Knopfdruck** (Einstellungen → Ink Blocks → „Herunterladen“ oder Befehl „Texterkennung: Modelle herunterladen“): Erkennungsmodell `naeyn/de-htr-web-v2` von Hugging Face (ca. 10 MB, Apache-2.0, fester Commit) und `ort-wasm-simd-threaded.wasm` von jsDelivr (ca. 14 MB, onnxruntime-web 1.30.0). Beides wird per SHA-256 geprüft und in `<plugin>/models/` abgelegt. Danach läuft alles offline.
- Optional, ebenfalls nur auf Knopfdruck: die Ausweich-Engines `naeyn/de-htr-web` v1 (Hugging Face, ca. 10 MB) und Tesseract.js 7 mit deutschen Sprachdaten (jsDelivr, ca. 5 MB).
