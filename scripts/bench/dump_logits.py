"""v2-Logits für die ScaDS-Val/Test-Zeilen (Split von naeyn/de-htr-web) einmal berechnen und speichern.

Aufruf: python -I dump_logits.py <daten-dir> <models/de-htr-web-v2> <ausgabe-dir>
<daten-dir> enthält split_manifest.json (github.com/naeyn/de-htr-web, data/) und unter x/ das entpackte
Zenodo-Archiv 10.5281/zenodo.18301532 (images/lines/*.png). Braucht numpy, pillow, onnxruntime.
"""
import json
import sys
from pathlib import Path

import numpy as np
import onnxruntime as ort
from PIL import Image

data_dir, model_dir, out_dir = map(Path, sys.argv[1:4])
cfg = json.loads((model_dir / "config.json").read_text())
manifest = json.loads((data_dir / "split_manifest.json").read_text())
sess = ort.InferenceSession(str(model_dir / "model.onnx"), providers=["CPUExecutionProvider"])
H, MAXW, STRIDE = cfg["image_height"], cfg["max_width"], cfg["output_stride"]


def prep(path):
    im = Image.open(path).convert("L")
    w, h = im.size
    rw = max(1, round(w * H / h))
    im = im.resize((rw, H), Image.Resampling.BILINEAR)
    if rw > MAXW:
        sh = max(1, round(H * MAXW / rw))
        small = im.resize((MAXW, sh), Image.Resampling.BILINEAR)
        im = Image.new("L", (MAXW, H), 255)
        im.paste(small, (0, (H - sh) // 2))
        rw = MAXW
    pw = (rw + 3) // 4 * 4
    canvas = Image.new("L", (pw, H), 255)
    canvas.paste(im, (0, 0))
    arr = np.asarray(canvas, dtype=np.float32) / 255.0
    return arr[None, None], rw


out_dir.mkdir(parents=True, exist_ok=True)
for split in ("val", "test"):
    index, chunks, offset = [], [], 0
    for line in manifest["lines"][split]:
        x, w = prep(data_dir / "x/images/lines" / Path(line["image"]).name)
        (logits,) = sess.run([cfg["output_name"]], {cfg["input_name"]: x})
        lg = logits.reshape(-1, logits.shape[-1])
        steps = min(-(-w // STRIDE), lg.shape[0])
        lg = np.ascontiguousarray(lg[:steps], dtype=np.float32)
        chunks.append(lg.tobytes())
        index.append({"id": line["id"], "writer": line["writer"], "text": line["text"], "offset": offset, "T": steps, "C": lg.shape[1]})
        offset += lg.size
    (out_dir / f"{split}.bin").write_bytes(b"".join(chunks))
    (out_dir / f"{split}.json").write_text(json.dumps(index, ensure_ascii=False))
    print(split, len(index), "Zeilen")
