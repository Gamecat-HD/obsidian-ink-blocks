# Ink Blocks (Obsidian-Plugin)

Mit dem Stift **direkt in normalen Notizen** schreiben und **Arbeitsblätter** (PDF-Seiten/Bilder) per Hand ausfüllen. Die Handschrift wird **lokal und kostenlos** in Text umgewandelt, damit der Vault und die Lernplattform sie durchsuchen können.

> Status: **M3 fertig** (Phase 1 komplett): Schreibfläche mit schwebender Werkzeugleiste, Stift/Textmarker/Radierer, Undo/Redo (Strg+Z bei aktivem Block), Hintergrund liniert/kariert/leer, wächst beim Schreiben nach unten. Als Nächstes: Arbeitsblätter (M4). Plan: [docs/AUFBAU.md](docs/AUFBAU.md).

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

- Das Plugin sendet **keine** Notiz- oder Handschriftdaten irgendwohin.
- Geplant (Phase 3): Beim ersten Aktivieren der Texterkennung werden einmalig das OCR-Modell (Hugging Face, ca. 10 MB) und die onnxruntime-WASM (jsDelivr) in den Plugin-Ordner geladen. Danach läuft alles offline.
