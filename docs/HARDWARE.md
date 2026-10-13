# Hardware: HP-Laptop + HP 700 Rechargeable Multi Pen

Stift: **HP 700 Rechargeable Multi Pen**, Teilenummer `93Z27AA#ABB`. Laptop-Modell noch offen.

## Der Stift

| Punkt | Befund | Quelle / Sicherheit |
|---|---|---|
| Protokolle | **MPP 2.0, Wacom AES 2.0, USI 1.0** | nur Händlerangaben ([HP Shop ZA](https://www.hpshop.co.za/products/hp-700-rechargeable-multi-pen-93z27aa-388788), [Harvey Norman](https://www.harveynorman.co.nz/computers/tablet-and-accessories/tablet-accessories/hp-700-rechargeable-mpp-2.0-multi-stylus-pen-black-93z27aa.html)); die HP-Seite war nicht erreichbar |
| Druck | 4096 Stufen | Händler |
| Tasten | 2, programmierbar (unter Windows mit HP Pen Control) | Händler, [HP Community](https://h30434.www3.hp.com/t5/Notebook-Software-and-How-To-Questions/HP-Pen-control-app-not-compatible/td-p/9016099) |
| Laden | USB-C | Händler |
| Protokollwahl | vermutlich automatisch | **unbestätigt** |
| Linux-Berichte | **keine gefunden** | – |

„Multi Pen“ ist hier ein Vorteil: Der Stift passt sowohl zu MPP- als auch zu AES-Digitizern. Entscheidend für Linux ist deshalb der **Digitizer im Laptop**.

## HP-Convertibles unter Linux

| Familie | Digitizer typ. | Linux |
|---|---|---|
| Envy / Spectre / Pavilion x360 | MPP, **ELAN** I2C-HID (`04F3:xxxx`) | Spitze und Druck gehen meist. Neigung, Radierer und Seitentasten sind unter libinput oft lückenhaft, das hängt am libwacom-Eintrag ([libinput #393](https://gitlab.freedesktop.org/libinput/libinput/issues/393), [Manjaro ELAN2514](https://forum.manjaro.org/t/touchscreen-elan2514-not-properly-detected-in-hp-envy-x360-15-eu0718ng/112252)) |
| EliteBook x360 / ZBook / Dragonfly | teils **Wacom AES** | Kernel-Treiber `wacom` und libwacom, in der Regel das beste Ergebnis ([Wacom](https://community.wacom.com/en-de/wacom-leads-the-way-with-pens-and-tablets-for-linux-2)) |

- `iptsd`/linux-surface wird nicht gebraucht, das betrifft nur Microsoft Surface.

**Empfehlung:**
- Für Linux ein Modell mit **Wacom-AES-Digitizer** bevorzugen und den Stift-Typ in den **QuickSpecs** des konkreten Modells (hp.com) prüfen.
- Treiber nur von hp.com laden. Eine Suche hat eine HP-Treiberseite auf einer fremden trycloudflare-Domain ausgespuckt.

## Testprotokoll (vor dem Kauf bzw. in der Rückgabefrist)

Am besten mit einem CachyOS-Live-USB direkt auf dem Gerät.

1. `cat /proc/bus/input/devices`: Taucht ein `… Pen`/`Stylus`-Gerät auf? Hersteller und Produkt-ID notieren.
2. `libinput list-devices`: Erscheint der Stift mit Capability `tablet`?
3. `libinput debug-events`: Kommen `TABLET_TOOL_AXIS` mit `pressure`, die Radierer-Annäherung und die Tasten an?
4. Obsidian mit diesem Plugin starten, Command **„Pen diagnostics“** ausführen. Dort schreiben, mit Druck, schräg, mit Radierer und Seitentaste. Dann **„Report kopieren“** und unten einfügen.
5. Schritt 4 mit `obsidian --ozone-platform=x11` wiederholen.
6. Hyprland: Stift per `hl.device({ name = "<Tablet-Name>", … })` auf den internen Monitor mappen. Bei Klick-Problemen nach Stiftnutzung Obsidian dauerhaft per `~/.config/obsidian/user-flags.conf` auf X11 umstellen.

### Was „gut“ heißt

| Wert im Report | Ziel |
|---|---|
| `pointerTypes` | enthält `pen` |
| Druckstufen | ≫ 10 verschiedene Werte, max nahe 1.0 |
| `coalesced/Move` | > 1 bei schnellen Strichen, sonst fehlen Zwischenpunkte |
| Move-Rate | ≥ 120 Hz |
| Radierer (32) | ja (sonst Radierer nur über Werkzeugwahl) |

## Erkennungsqualität mit der eigenen Handschrift

1. Befehl **„OCR-Messung: Notiz mit 30 Testsätzen anlegen“**
2. Jeden Satz mit dem Stift in die Fläche darunter schreiben, so wie man normal schreibt. Teilmengen reichen auch.
3. Befehl **„OCR-Messung auswerten“**: Am Ende der Notiz erscheint eine Tabelle mit erkanntem Text und Zeichenfehlerrate (CER) pro Zeile sowie gesamt.
4. Bei auffälligen Zeilen: **„OCR-Debug: Segmentbilder dieser Notiz speichern“**. Das zeigt, wie das Modell die Zeilen sieht (Zerlegung, Strichstärke, Größe).
5. Gesamt-CER und Auffälligkeiten unten eintragen. Zum Vergleich: In den Benchmarks des Modells liegt de-htr-web-v2 bei ca. 8 % CER.

## Ergebnisse

<!-- Pen-Reports hier einfügen: Gerät, Kernel, Wayland/X11 -->
