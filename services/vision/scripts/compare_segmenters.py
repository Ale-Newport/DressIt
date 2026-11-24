"""Compare rembg background-removal models on the single-garment eval photos.

For every candidate model it reports latency (CPU, onnxruntime) and a downstream,
label-based quality proxy: category accuracy / mean probability of the true
category when FashionSigLIP classifies that model's cutout. It also writes a
contact sheet (``eval/out/segmenters.jpg``) for visual inspection of the masks.

    uv run python scripts/compare_segmenters.py [--models isnet-general-use,birefnet-general-lite,u2net]
"""

from __future__ import annotations

import argparse
import csv
import json
import statistics
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import numpy as np  # noqa: E402
from PIL import Image, ImageDraw  # noqa: E402

from app.config import get_settings  # noqa: E402
from app.imaging import content_box, decode_image, resize_max_side  # noqa: E402
from app.models import get_backend  # noqa: E402
from app.models.torch_backend import _Lazy  # noqa: E402
from app.pipeline.analyze import Candidate, _prepare  # noqa: E402
from app.pipeline.classify import get_heads  # noqa: E402
from app.pipeline.masks import clean_mask, embedding_view  # noqa: E402

DEFAULT_MODELS = "isnet-general-use,birefnet-general-lite,u2net"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--models", default=DEFAULT_MODELS)
    args = ap.parse_args()
    settings = get_settings()
    backend = get_backend()
    heads = get_heads(backend, settings)
    rows = [
        r for r in csv.DictReader((ROOT / "eval" / "manifest.csv").open(encoding="utf-8"))
        if r["mode"] == "single" and "WORN" not in r["notes"]
    ]
    sub_ids = [i for i in heads.garment.ids]
    vocab_cat = {s.id: s.category for s in heads.vocab.subcategories}
    report: dict[str, dict[str, float]] = {}
    tiles: dict[str, list[Image.Image]] = {}
    for model in args.models.split(","):
        from rembg import new_session

        backend._rembg = _Lazy(model, lambda m=model: new_session(m, providers=["CPUExecutionProvider"]))  # type: ignore[attr-defined]
        backend._rembg.get()  # load outside the timed region
        times, correct, true_prob, fg = [], 0, [], []
        tiles[model] = []
        for r in rows:
            img, _ = resize_max_side(decode_image((ROOT / "eval" / r["file"]).read_bytes()).rgb, settings.working_max_side)
            rgb = np.asarray(img)
            x0, y0, x1, y1 = content_box(rgb)
            rgb = np.ascontiguousarray(rgb[y0:y1, x0:x1])
            t = time.perf_counter()
            prob = backend.remove_background(Image.fromarray(rgb))
            times.append((time.perf_counter() - t) * 1000)
            mask = clean_mask(prob)
            if mask.sum() < 50:
                mask = np.ones_like(mask)
            c = Candidate(prob=prob, mask=mask)
            _prepare(c, rgb, settings)
            fg.append(float(mask.mean()))
            p = heads.garment.probs(backend.embed_images([embedding_view(c.cutout)]))[0]
            cats: dict[str, float] = {}
            for i, sid in enumerate(sub_ids):
                if sid in vocab_cat:
                    cats[vocab_cat[sid]] = cats.get(vocab_cat[sid], 0.0) + float(p[i])
            true_prob.append(cats.get(r["category"], 0.0))
            correct += int(max(cats, key=cats.get) == r["category"])
            tile = Image.new("RGB", c.cutout.size, (120, 200, 120))
            tile.paste(c.cutout, (0, 0), c.cutout)
            tile.thumbnail((160, 160))
            tiles[model].append(tile)
        report[model] = {
            "images": len(rows),
            "category_accuracy": round(correct / len(rows), 3),
            "mean_true_category_prob": round(statistics.mean(true_prob), 3),
            "latency_ms_p50": round(statistics.median(times), 1),
            "latency_ms_p95": round(float(np.percentile(times, 95)), 1),
            "mean_foreground_fraction": round(statistics.mean(fg), 3),
        }
        print(model, report[model], flush=True)
    out_dir = ROOT / "eval" / "out"
    out_dir.mkdir(parents=True, exist_ok=True)
    models = list(tiles)
    n = max(len(v) for v in tiles.values())
    sheet = Image.new("RGB", (170 * n + 200, 170 * len(models)), "white")
    d = ImageDraw.Draw(sheet)
    for j, m in enumerate(models):
        d.text((5, 170 * j + 80), m, fill="black")
        for i, t in enumerate(tiles[m]):
            sheet.paste(t, (200 + 170 * i, 170 * j))
    sheet.save(out_dir / "segmenters.jpg", quality=80)
    (out_dir / "segmenters.json").write_text(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
