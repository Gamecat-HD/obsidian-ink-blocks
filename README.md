# Ink Blocks (Obsidian-Plugin)

Mit dem Stift **direkt in normalen Notizen** schreiben und **Arbeitsblätter** (PDF-Seiten/Bilder) per Hand ausfüllen. Die Handschrift wird **lokal und kostenlos** in Text umgewandelt, damit der Vault und die Lernplattform sie durchsuchen können.

> Status: **v0.7.0**: Schreibflächen, Arbeitsblätter, lokale Texterkennung (M1–M7); Ausklappen und Beschriften (M8); Live-Strich, iPad-Modus, Linienabstand, Textmarker mit Lineal, Formerkennung (M9–M14); Beam-Search mit Vault-Sprachmodell (M15); Lasso, präziser Radierer, Abdeckband, eigene Farben, Gesten/Zoom (M16–M20); Eingabeprofile für Tablets und Schreibtraining (M21–M24); Schreibfläche löschen (M25); stabile Ansicht beim Schreiben und Schnittstelle für Echtzeit-Zusammenarbeit (M26–M29); flüssigeres Schreiben auf vollen Seiten (M30); Blame für Zusammenarbeit (M31). Getestet in einer echten Obsidian-Instanz (E2E) mit Maus, simuliertem Stift und Touch; Stift live auf dem HP-Laptop bestätigt → [docs/HARDWARE.md](docs/HARDWARE.md).

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
| **Schreibtraining: Diktat** | 1–3 Wörter werden vorgegeben, du schreibst sie; jede Probe verbessert die Erkennung deiner Schrift (siehe unten) |
| **Schreibtraining: Erkennung dieser Notiz überprüfen** | Erkannte Wörter einzeln mit ihren Strichen bestätigen oder korrigieren |
| **Schreibtraining: Unsichere Wörter der letzten Schreibflächen überprüfen** | Dasselbe über die 25 zuletzt geänderten Flächen im Vault |
| **Schreibtraining: Erkennung auf meine Schrift abstimmen** | Gewichte von Zweitmodell und Sprachmodell auf deine Proben abstimmen |
| **Schreibtraining: Buchstaben für Wortvorschläge** | Fehlende oder unsichere Buchstaben einzeln schreiben, damit Wortvorschläge in der eigenen Schrift erscheinen (etwa 2–3 Minuten) |
| **Wortvorschläge ein- oder ausschalten** | Wie der Funken-Knopf in der Werkzeugleiste |
| **Pen diagnostics** | Stift testen: Druck, Neigung, Radierer, Event-Rate |
| **iPad-Modus umschalten** | Obsidian auf die Touch-Oberfläche umschalten und zurück (siehe unten) |

**In der Fläche:**
- Mit Stift oder Maus schreiben.
- Radieren über das Radierer-Werkzeug, das Radierer-Ende oder die Seitentaste des Stifts. **Nochmal auf den Radierer tippen** öffnet die Optionen: ganze Striche oder **präzise** (nur die berührten Stellen, Striche werden geteilt) und **nur Textmarker radieren**. Die drei Breiten-Knöpfe stellen beim Radierer dessen Größe ein; ein Kreis zeigt sie beim Darüberfahren.
- **Lasso** (Schlaufen-Knopf): Striche einkreisen, dann im Rahmen ziehen = verschieben, am Griff unten rechts ziehen = vergrößern/verkleinern. Die Leiste an der Auswahl: Löschen, Ausschneiden, Kopieren, Duplizieren, **Farbe ändern**, **In Text umwandeln** (lokale Erkennung: kopieren, unter dem Block einfügen oder die Handschrift ersetzen) und **Als Bild kopieren** (PNG in die Zwischenablage). Tasten: Entf, Strg+C/X/V/D, Strg+A, Pfeiltasten (mit Umschalt weiter), Esc. Kopierte Striche lassen sich in jeden anderen Block einfügen: Strg+V, Rechtsklick → „Hier einfügen“ oder mit dem Lasso ins Leere tippen.
- **Abdeckband** (Pflaster-Knopf) zum Lernen wie in GoodNotes: Antworten abkleben, Tippen mit Stift oder Finger deckt auf bzw. wieder zu. Das Auge in der Leiste deckt alle Bänder auf bzw. zu. Aufgedeckt gilt nur für die laufende Sitzung; beim nächsten Öffnen ist wieder alles abgedeckt. Das Band deckt auch auf Arbeitsblättern und in der Lernplattform (dort per Klick aufdecken).
- **Eigene Farben:** „+“ hinter den Farben öffnet den Farbwähler. Die Farbe wird je Werkzeug gemerkt (bis zu vier), Rechtsklick bzw. langes Drücken entfernt sie.
- **Gesten:** mit zwei Fingern tippen = Rückgängig, mit drei Fingern = Wiederholen. Zwei Finger scrollen die Notiz.
- Wer zeichnet, stellt **„Eingabe auf diesem Gerät“** ein (siehe unten „Tablets“): mit aktivem Stift scrollen Finger, ohne Stift zeichnen Finger und zwei Finger scrollen.
- **Ausklappen** (Button ⤢ in der Leiste): öffnet dieselbe Fläche groß im Fenster, wie hineingezoomt. Ideal zum bequemen Schreiben und zum Ausfüllen von Arbeitsblättern. Dort lässt sich **zoomen** (100–300 %): mit zwei Fingern (Pinch, dabei auch verschieben), mit Strg+Mausrad bzw. Touchpad-Pinch oder mit den Lupen-Knöpfen; ein Klick auf die Prozentzahl setzt zurück. Die Leiste steht dabei fest oben. Esc oder ⤡ klappt wieder ein; alles landet sofort im Block.
- **Löschen** (Mülleimer in der Leiste): entfernt den Block aus der Notiz und legt die `.ink`-Datei in den Papierkorb (wiederherstellbar). Leere Flächen gehen sofort, sonst nach Rückfrage. Zeigt ein kopierter Block noch auf dieselbe Datei, bleibt sie erhalten. Strg+Z in der Notiz holt den Block zurück, die Handschrift dann aus dem Papierkorb.
- **Eingebettete Bilder/PDFs:** Beim Überfahren erscheint „Beschriften“. Ein Klick macht daraus Arbeitsblatt-Flächen mit dem Bild bzw. der PDF-Seite als Hintergrund (bei PDFs Seite oder alle Seiten wählbar).
- Die **Werkzeugleiste** erscheint über der Fläche, wenn man mit Maus oder Stift darüberfährt bzw. sobald der Block aktiv ist. Sie bietet Stift, Textmarker, Radierer, Farben, 3 Breiten (fein/mittel/breit), Rückgängig/Wiederholen und das **Hintergrund-Menü**: liniert, kariert, Punkteraster oder leer, dazu Linienabstand bzw. Kästchengröße nur für diese Fläche (Eng/Mittel/Weit bzw. Klein/Mittel/Groß, „Standard“ = aus den Einstellungen). **„Zeilenabstand einstellen …“** öffnet einen Schieberegler direkt unter dem Knopf: Die Fläche zeigt den Abstand schon beim Ziehen, „Fertig“/Enter/Klick daneben speichert ihn im Block (`gap:`), Esc verwirft.
- **Textmarker:** 6 Farben, 3 Breiten, liegt immer unter der Schrift (auch beim Zeichnen). Mit dem **Lineal** (Knopf in der Leiste, nur beim Textmarker; Standard: an) zieht er gerade Linien vom Ansatzpunkt zum Stift, nahe der Waagerechten exakt waagerecht. Auf Arbeitsblättern wirkt er wie ein echter Marker: Gedruckter Text darunter bleibt dunkel.
- **Formen:** Linie, Rechteck, Dreieck oder Kreis/Ellipse zeichnen und den Stift am Ende kurz (½ s) ruhig halten. Daraus wird eine saubere Form (gerade Linien rasten waagerecht/senkrecht ein). Ohne Halten bleibt alles Freihand; abschaltbar in den Einstellungen. Formen landen nicht im erkannten Text.
- **Einstellungen:** Standard-Linienabstand und Kästchengröße sowie die drei Strichbreiten von Stift und Textmarker sind frei einstellbar. Breiten gelten für neue Striche.
- **Strg+Z / Strg+Umschalt+Z / Strg+Y** wirken auf die Tinte, solange der Block aktiv ist, also nach dem Antippen. Ein Klick in den Text gibt die Tasten wieder an den Editor.
- Der **erkannte Text** steht dezent unter der Fläche (Klick klappt ihn auf) und im Feld `text:` des Blocks. Darüber finden ihn die Obsidian-Suche, Omnisearch und die Lernplattform.

**iPad-Modus** (nur Desktop-App, z. B. auf einem Convertible):
- Knopf in der linken Leiste (Tablet-Symbol) oder Befehl „iPad-Modus umschalten“. Obsidian lädt neu und zeigt seine Tablet-Oberfläche: große Bedienelemente, Wischen für die Seitenleisten, alles per Finger bedienbar.
- Die Ink-Leiste ist dort immer sichtbar und größer, „Beschriften“ an Bildern/PDFs ebenso.
- Zurück: schwebender Knopf unten rechts (Monitor-Symbol) oder derselbe Befehl. Die Desktop-Anordnung bleibt erhalten.
- Gilt nur für dieses Gerät (wird nicht synchronisiert). Notfalls in den Entwicklertools (Strg+Umschalt+I): `app.emulateMobile(false)`.
- Tipp: Unter Einstellungen → Mobil → Werkzeugleiste „Schreibfläche einfügen“ aufnehmen.
- Technik: nutzt Obsidians eingebaute, nicht offiziell dokumentierte Mobil-Emulation (`app.emulateMobile`).

**Tablets (Android, iPad) und Geräte ohne aktiven Stift:**
- Einstellungen → Ink Blocks → **Eingabe auf diesem Gerät**: „Stift zeichnet, Finger scrollen“, „Finger zeichnen, zwei Finger scrollen“ oder **Automatisch**. Automatisch lässt auf Tablets zunächst Finger (und passive Stifte, die sich wie Finger melden) zeichnen und schaltet beim **ersten echten Stiftkontakt** (S Pen, Apple Pencil, USI/MPP-Stift) auf „nur Stift“ um. Der Knopf ↺ daneben vergisst den Stift wieder.
- Im Finger-Modus zählt eine große Kontaktfläche als Handballen und zeichnet nicht. Zwei Finger scrollen, Zwei-/Drei-Finger-Tipp = Rückgängig/Wiederholen.
- Gilt je Gerät (liegt nicht in `data.json`, wird also nicht synchronisiert).
- **Sparmodus auf diesem Gerät** (auf Tablets/Handys standardmäßig an): Die Texterkennung nimmt nur v2 in der kleinen int8-Fassung, ohne v1 als Zweitmodell – rund ein Viertel des Speichers.
- **Große Modellfassung im Sparmodus** (Standard aus): nimmt trotzdem das fp32-Modell, wenn es geladen ist. Auf dem Galaxy Tab S10 FE liest es ein Wort in etwa 0,09 s statt 0,45 s, braucht aber rund 30 MB mehr Speicher.
- Das Schreibtraining erreicht man dort über das **Hut-Symbol** in der Seitenleiste.

**Schreibtraining** (verbessert die Erkennung deiner eigenen Schrift):
- **Diktat:** Es erscheinen 1–3 Wörter – aus deinen Notizen, deinen Fachbegriffen, Wörter mit Umlauten/ß sowie Zahlen und IP-Adressen. Schreib sie auf die Fläche, **Weiter** (Enter) erkennt sie, zeigt das Ergebnis und legt Striche + Vorgabe als Probe ab. „Automatisch weiter“ geht nach einer kurzen Schreibpause von selbst weiter. Zeichen, die bei dir oft falsch gelesen werden, kommen häufiger dran.
- **Überprüfen:** zeigt erkannte Wörter einzeln mit ihren Strichen (Nachbarwörter blass), die unsichersten zuerst. **Richtig**, Text ändern und **Übernehmen** (Enter; Vorschläge darunter antippen), **Kein Text** (Zeichnung, Gekritzel – fällt aus dem Text) oder **Überspringen**. Korrekturen stehen sofort im `text:` des Blocks und bleiben, bis sich die Striche ändern – auch wenn die Erkennung neu läuft.
- **Lernen:** Korrigierte Wörter fließen ins Sprachmodell (wie Fachbegriffe), bestätigte einfach (Einstellung „Korrekturen lernen“).
- **Abstimmen** (ab 20 Proben): sucht auf deinen Proben die besten Gewichte für v1 im Ensemble und das Sprachmodell. Jede fünfte Probe bleibt als Kontrolle draußen; übernommen wird nur, was dort nicht schlechter ist. ↺ in den Einstellungen setzt zurück.
- Die Proben liegen in `<Ink-Ordner>/_training/samples-<Gerät>.jsonl` im Vault (je Gerät eine Datei, damit der Sync keine Konflikte erzeugt) und kommen so von allen Geräten zusammen.

**Block-Syntax:**

````markdown
```ink
file: _ink/2026-10-13-notiz-a1b2.ink
bg: "[[Arbeitsblatt.pdf#page=2]]"
bgStyle: grid
gap: 18
text: |
  erkannter Text
```
````

**Installation (manuell):** Nach `npm run build` die Dateien `main.js`, `manifest.json` und `styles.css` nach `<vault>/.obsidian/plugins/obsidian-ink-blocks/` kopieren und das Plugin unter Einstellungen → Community-Plugins aktivieren. Danach unter Einstellungen → Ink Blocks das Erkennungsmodell herunterladen.

**Wortvorschläge beim Schreiben** (Standard aus, Funken-Knopf in der Werkzeugleiste):
- Nach dem Absetzen des Stifts wird das angefangene Wort gelesen und blass weitergeschrieben – mit Wörtern und Wortfolgen aus den eigenen Notizen, bevorzugt aus der aktuellen Notiz und passend zum Wort davor.
- Antippen übernimmt den Vorschlag als echte Striche (ein Schritt Rückgängig), danach erscheint gleich die Fortsetzung. Weiterschreiben verwirft ihn. Was rechts nicht passt, rutscht auf die nächste Linie.
- Die Buchstaben stammen aus den eigenen Schriftproben; fehlende ersetzt eine Einstrich-Schrift, bis sie im Schreibtraining („Buchstaben für Wortvorschläge“) geschrieben wurden.
- **Vorschläge von Claude** (Standard aus): Findet sich lokal nichts, fragt das Plugin Claude Haiku über den Dienst `scripts/ink-claude.py`, der neben Obsidian läuft (z. B. in Termux) und die Anmeldung von Claude Code nutzt. Etwa 2 s je Vorschlag; schreibt man ihn weiter, kommt der Rest ohne neue Anfrage.

## Zusammenarbeit (Tandem)

Ink Blocks bietet eine optionale Schnittstelle für Echtzeit-Zusammenarbeit (`app.plugins.plugins["obsidian-ink-blocks"].api`, siehe `src/api.ts`). Das Plugin [Tandem](https://github.com/Gamecat-HD/obsidian-tandem) nutzt sie:
- Andere sehen deinen Strich **schon während des Schreibens** als halbtransparenten Strich mit deinem Namen. Der fertige Strich (gleiche ID) ersetzt ihn.
- Man sieht, wo der Stift (oder die Maus) der anderen gerade über der Fläche ist: ein Ring mit Namen, solange er schwebt, und ein gefüllter Punkt beim Schreiben.
- **Blame:** Ist in Tandem „Blame“ an, bekommt jeder Strich einen weichen Schein in der Farbe der Person, die ihn gezeichnet hat. Oben rechts steht eine Legende (wer, wann zuletzt). Fährt man mit Maus oder Stift über einen Strich, erscheinen Name, Gerät und Zeit, und die Striche dieser Person werden hervorgehoben (`api.setBlame`).
- Nach jeder Änderung wird sofort gespeichert, statt nach 1,5 s.
- Zeichnet jemand anderes auf derselben Fläche, bleibt dein Undo-Verlauf erhalten (nur wenn fremde Änderungen etwas entfernen, wird er geleert).

Ohne Tandem ändert sich nichts.

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

**Echter Stift-Eingabeweg (Wayland):** `node scripts/e2e/pen/live-stroke.mjs` öffnet die Test-Instanz als Fenster auf Hyprland-Workspace 9 und schreibt mit einem virtuellen uinput-Stift (`scripts/e2e/pen/vpen.py`, braucht python-evdev und Schreibrecht auf `/dev/uinput`). `grim` fotografiert den Bildschirm mitten im Strich und nach dem Absetzen, zum Vergleich auch im Pen-Diagnose-Dialog. Optionen: `--palm dx,dy` legt zusätzlich einen Handballen (virtueller Touchscreen) auf, `--vault <Vorlage>` nimmt eine Vault-Kopie mit eigenem Theme und Plugins, `--plugin-from <dir>` testet einen anderen Build. Der Stift-Cursor bewegt sich dabei ca. 30 s auf dem echten Bildschirm.

## Netzwerk und Datenschutz

- Das Plugin sendet **keine** Notiz- oder Handschriftdaten irgendwohin. Die Texterkennung läuft lokal (onnxruntime-web/Wasm in einem Worker).
- Ausnahme, nur wenn **„Vorschläge von Claude“** eingeschaltet ist: Dann gehen Titel und Anfang der aktuellen Notiz (bis 600 Zeichen) und der zuletzt geschriebene Text (bis 300 Zeichen) an den lokalen Dienst `ink-claude` und von dort über Claude Code an Anthropic. Der Dienst hört nur auf 127.0.0.1 und verlangt einen Schlüssel; Claude bekommt dabei keine Werkzeuge.
- **Einmaliger Download, nur auf Knopfdruck** (Einstellungen → Ink Blocks → „Herunterladen“ oder Befehl „Texterkennung: Modelle herunterladen“): Erkennungsmodell `naeyn/de-htr-web-v2` von Hugging Face (ca. 10 MB, Apache-2.0, fester Commit) und `ort-wasm-simd-threaded.wasm` von jsDelivr (ca. 14 MB, onnxruntime-web 1.30.0). Beides wird per SHA-256 geprüft und in `<plugin>/models/` abgelegt. Danach läuft alles offline.
- Empfohlen, ebenfalls nur auf Knopfdruck: `naeyn/de-htr-web` v1 (Hugging Face, ca. 10 MB). Zusammen mit v2 erkennt es per Ensemble gut 10 % weniger Fehler. Dazu dasselbe v2-Modell ungerechnet als `model-fp32.onnx` (ca. 40 MB), das 3–4× schneller erkennt. Optional: Tesseract.js 7 mit deutschen Sprachdaten (jsDelivr, ca. 5 MB) als letzte Ausweich-Engine.

## Lizenz

[MIT](LICENSE). Die Erkennungsmodelle werden nicht mitgeliefert und stehen unter ihren eigenen Lizenzen (siehe oben).
