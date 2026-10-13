# Ink Blocks (Obsidian-Plugin)

Mit dem Stift **direkt in normalen Notizen** schreiben und **Arbeitsblätter** (PDF-Seiten/Bilder) per Hand ausfüllen. Die Handschrift wird **lokal und kostenlos** in Text umgewandelt, damit der Vault und die Lernplattform sie durchsuchen können.

> Status: **M6 fertig**: Schreibflächen (Werkzeugleiste, Undo/Redo, Mitwachsen), **Arbeitsblätter** (PDF-Seiten/Bilder als Hintergrund) und **lokale Texterkennung**. Die Handschrift landet als Text im `text:`-Feld des Blocks und ist damit in Obsidian und der Lernplattform durchsuchbar. Fällt das Modell aus, springt die Erkennung automatisch auf de-htr-web v1 bzw. Tesseract.js um (M6). Als Nächstes: Politur (M7). Plan: [docs/AUFBAU.md](docs/AUFBAU.md).

## Dokumentation

- [docs/ANALYSE.md](docs/ANALYSE.md): technische Bewertung, Architektur, Roadmap
- [docs/HARDWARE.md](docs/HARDWARE.md): HP-Laptop + HP 700 Multi Pen unter Linux/Hyprland, Testprotokoll
- [docs/RECOGNITION.md](docs/RECOGNITION.md): lokale Texterkennung (de-htr-web-v2 → v1 → Tesseract.js), Anbindung an die Suche
- [docs/AUFBAU.md](docs/AUFBAU.md): Implementierungsplan Phase 1–3 (Module, Datenformat, Algorithmen, Meilensteine M1–M7)
- [docs/SPIKES.md](docs/SPIKES.md): Ergebnisse der Machbarkeitstests (ORT im Worker, pdf.js, Tesseract offline, Live-Preview-Re-Render)

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

Zum Testen `main.js`, `manifest.json` und `styles.css` nach `<vault>/.obsidian/plugins/obsidian-ink-blocks/` kopieren oder den Ordner dorthin symlinken. Danach das Plugin in den Einstellungen aktivieren.

## Netzwerk und Datenschutz

- Das Plugin sendet **keine** Notiz- oder Handschriftdaten irgendwohin. Die Texterkennung läuft lokal (onnxruntime-web/Wasm in einem Worker).
- **Einmaliger Download, nur auf Knopfdruck** (Einstellungen → Ink Blocks → „Herunterladen“ oder Befehl „Texterkennung: Modelle herunterladen“): Erkennungsmodell `naeyn/de-htr-web-v2` von Hugging Face (ca. 10 MB, Apache-2.0, fester Commit) und `ort-wasm-simd-threaded.wasm` von jsDelivr (ca. 14 MB, onnxruntime-web 1.30.0). Beides wird per SHA-256 geprüft und in `<plugin>/models/` abgelegt. Danach läuft alles offline.
- Optional, ebenfalls nur auf Knopfdruck: die Ausweich-Engines `naeyn/de-htr-web` v1 (Hugging Face, ca. 10 MB) und Tesseract.js 7 mit deutschen Sprachdaten (jsDelivr, ca. 5 MB).
