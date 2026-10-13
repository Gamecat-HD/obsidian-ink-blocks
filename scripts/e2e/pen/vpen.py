#!/usr/bin/env python3
"""Virtueller Stift über /dev/uinput (braucht Schreibrecht darauf und python-evdev).

Der Compositor sieht ihn wie einen echten Digitizer (libinput: Capability tablet), Chromium bekommt die
Events also über denselben Weg wie vom echten Stift (Wayland tablet_v2) – anders als CDP-Input.

Koordinaten sind logische Bildschirm-Pixel; der Bereich wird mit --width/--height auf den Monitor gelegt.
Befehle zeilenweise über stdin (Antwort "ok" je Zeile):
  hover X Y          Stift in Reichweite, ohne Kontakt
  down X Y P         aufsetzen (P = Druck 0..1)
  move X Y P         bewegen (mit oder ohne Kontakt)
  up                 abheben (bleibt in Reichweite)
  out                aus der Reichweite
  palm X Y           Handballen (zweites Gerät: Touchscreen) auflegen bzw. verschieben
  palmup             Handballen abheben
  sleep MS
"""
import argparse
import sys
import time

from evdev import AbsInfo, UInput, ecodes as e

ap = argparse.ArgumentParser()
ap.add_argument("--width", type=int, required=True)
ap.add_argument("--height", type=int, required=True)
args = ap.parse_args()

SCALE = 10  # Geräteeinheiten je logischem Pixel (feinere Auflösung als der Bildschirm)
PMAX = 4095
cap = {
    e.EV_KEY: [e.BTN_TOOL_PEN, e.BTN_TOUCH, e.BTN_STYLUS, e.BTN_STYLUS2],
    e.EV_ABS: [
        (e.ABS_X, AbsInfo(0, 0, args.width * SCALE, 0, 0, 40)),
        (e.ABS_Y, AbsInfo(0, 0, args.height * SCALE, 0, 0, 40)),
        (e.ABS_PRESSURE, AbsInfo(0, 0, PMAX, 0, 0, 0)),
        (e.ABS_TILT_X, AbsInfo(0, -60, 60, 0, 0, 0)),
        (e.ABS_TILT_Y, AbsInfo(0, -60, 60, 0, 0, 0)),
    ],
}
ui = UInput(cap, name="ink-blocks virtual pen", input_props=[e.INPUT_PROP_DIRECT])
touch = UInput(
    {
        e.EV_KEY: [e.BTN_TOUCH],
        e.EV_ABS: [
            (e.ABS_X, AbsInfo(0, 0, args.width * SCALE, 0, 0, 40)),
            (e.ABS_Y, AbsInfo(0, 0, args.height * SCALE, 0, 0, 40)),
            (e.ABS_MT_SLOT, AbsInfo(0, 0, 9, 0, 0, 0)),
            (e.ABS_MT_TRACKING_ID, AbsInfo(0, 0, 65535, 0, 0, 0)),
            (e.ABS_MT_POSITION_X, AbsInfo(0, 0, args.width * SCALE, 0, 0, 40)),
            (e.ABS_MT_POSITION_Y, AbsInfo(0, 0, args.height * SCALE, 0, 0, 40)),
            (e.ABS_MT_TOUCH_MAJOR, AbsInfo(0, 0, 255, 0, 0, 0)),
        ],
    },
    name="ink-blocks virtual touchscreen",
    input_props=[e.INPUT_PROP_DIRECT],
)
time.sleep(1.0)  # Compositor das Gerät erkennen lassen


def pos(x, y, p=None):
    ui.write(e.EV_ABS, e.ABS_X, round(float(x) * SCALE))
    ui.write(e.EV_ABS, e.ABS_Y, round(float(y) * SCALE))
    if p is not None:
        ui.write(e.EV_ABS, e.ABS_PRESSURE, round(float(p) * PMAX))


in_range = False
palm_down = False
palm_id = 1
print("ready", flush=True)
for line in sys.stdin:
    cmd, *a = line.split()
    if cmd in ("hover", "down", "move"):
        if not in_range:
            ui.write(e.EV_KEY, e.BTN_TOOL_PEN, 1)
            in_range = True
        pos(a[0], a[1], a[2] if len(a) > 2 else (0 if cmd == "hover" else None))
        if cmd == "down":
            ui.write(e.EV_KEY, e.BTN_TOUCH, 1)
    elif cmd == "up":
        ui.write(e.EV_ABS, e.ABS_PRESSURE, 0)
        ui.write(e.EV_KEY, e.BTN_TOUCH, 0)
    elif cmd == "out":
        ui.write(e.EV_ABS, e.ABS_PRESSURE, 0)
        ui.write(e.EV_KEY, e.BTN_TOUCH, 0)
        ui.write(e.EV_KEY, e.BTN_TOOL_PEN, 0)
        in_range = False
    elif cmd == "palm":
        x, y = round(float(a[0]) * SCALE), round(float(a[1]) * SCALE)
        touch.write(e.EV_ABS, e.ABS_MT_SLOT, 0)
        if not palm_down:
            touch.write(e.EV_ABS, e.ABS_MT_TRACKING_ID, palm_id)
            touch.write(e.EV_KEY, e.BTN_TOUCH, 1)
            palm_down = True
        touch.write(e.EV_ABS, e.ABS_MT_POSITION_X, x)
        touch.write(e.EV_ABS, e.ABS_MT_POSITION_Y, y)
        touch.write(e.EV_ABS, e.ABS_MT_TOUCH_MAJOR, 80)
        touch.write(e.EV_ABS, e.ABS_X, x)
        touch.write(e.EV_ABS, e.ABS_Y, y)
        touch.syn()
    elif cmd == "palmup":
        touch.write(e.EV_ABS, e.ABS_MT_SLOT, 0)
        touch.write(e.EV_ABS, e.ABS_MT_TRACKING_ID, -1)
        touch.write(e.EV_KEY, e.BTN_TOUCH, 0)
        touch.syn()
        palm_down = False
        palm_id += 1
    elif cmd == "sleep":
        time.sleep(float(a[0]) / 1000)
    elif cmd == "quit":
        break
    ui.syn()
    print("ok", flush=True)

ui.close()
touch.close()
