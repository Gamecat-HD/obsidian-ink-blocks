# Ink Blocks (Obsidian-Plugin)

Mit dem Stift **direkt in normalen Notizen** schreiben und **Arbeitsblätter** (PDF-Seiten/Bilder) per Hand ausfüllen. Die Handschrift wird **lokal und kostenlos** in Text umgewandelt, damit der Vault und die Lernplattform sie durchsuchen können.

> Status: **Phase 0**, Analyse und Gerüst. Enthalten ist bisher nur der Command **„Pen diagnostics“** zum Testen der Stift-Hardware sowie ein Platzhalter für den `ink`-Codeblock.

## Dokumentation

- [docs/ANALYSE.md](docs/ANALYSE.md): technische Bewertung, Architektur, Roadmap
- [docs/HARDWARE.md](docs/HARDWARE.md): HP-Laptop + HP 700 Multi Pen unter Linux/Hyprland, Testprotokoll
- [docs/RECOGNITION.md](docs/RECOGNITION.md): lokale Texterkennung (de-htr-web-v2 → v1 → Tesseract.js), Anbindung an die Suche
- [docs/AUFBAU.md](docs/AUFBAU.md): Implementierungsplan Phase 1–3 (Module, Datenformat, Algorithmen, Meilensteine M1–M7)

## Entwicklung

```sh
npm install
npm run dev     # esbuild watch → main.js
npm run build   # Typecheck + Production-Build
```

Zum Testen `main.js`, `manifest.json` und `styles.css` nach `<vault>/.obsidian/plugins/obsidian-ink-blocks/` kopieren oder den Ordner dorthin symlinken. Danach das Plugin in den Einstellungen aktivieren.

## Netzwerk und Datenschutz

- Das Plugin sendet **keine** Notiz- oder Handschriftdaten irgendwohin.
- Geplant (Phase 3): Beim ersten Aktivieren der Texterkennung werden einmalig das OCR-Modell (Hugging Face, ca. 10 MB) und die onnxruntime-WASM (jsDelivr) in den Plugin-Ordner geladen. Danach läuft alles offline.
