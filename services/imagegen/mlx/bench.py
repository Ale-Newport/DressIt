"""Offline bench of the studio-photo generator on the inputs the API sends (services/api/scripts/studio-dataset.ts):

    .mflux-venv/bin/python mlx/bench.py <dataset-dir> <out-dir> [--quantize 8|4|0] [--steps 4]
        [--size 832x1040] [--reference-mp 0.5] [--seed 1234] [--only id,id] [--prompt-file name]
        [--second-reference cutout|zoom]

Writes <out>/<item>.png and <out>/times.json (seconds per image, model load, peak memory). Used to keep
only settings that make the image in under 30 s on the Mac.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
import tempfile
import time

from PIL import Image, ImageOps


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("dataset")
    ap.add_argument("out")
    ap.add_argument("--model", default="flux2-klein-4b")
    ap.add_argument("--quantize", type=int, default=8)
    ap.add_argument("--steps", type=int, default=4)
    ap.add_argument("--size", default="832x1040")
    ap.add_argument("--reference-mp", type=float, default=0.5)
    ap.add_argument("--seed", type=int, default=1234)
    ap.add_argument("--only", default="")
    ap.add_argument("--prompt-file", default="prompt.txt")
    ap.add_argument("--second-reference", default="")
    ap.add_argument("--guidance", type=float, default=None)
    a = ap.parse_args()

    import mlx.core as mx
    from mflux.models.common.config import ModelConfig
    from mflux.models.flux2.variants import Flux2KleinEdit

    mx.set_cache_limit(2 * 2**30)
    os.makedirs(a.out, exist_ok=True)
    t0 = time.time()
    model = Flux2KleinEdit(
        model_config=ModelConfig.from_name(a.model),
        quantize=a.quantize or None,
        compute_precision=mx.float16,
    )
    mx.clear_cache()
    load_s = time.time() - t0
    w, h = (int(v) // 16 * 16 for v in a.size.split("x"))
    items = sorted(d for d in os.listdir(a.dataset) if os.path.isdir(os.path.join(a.dataset, d)))
    if a.only:
        keep = set(a.only.split(","))
        items = [d for d in items if d in keep]
    times: dict[str, float] = {}
    for it in items:
        src = os.path.join(a.dataset, it)
        pf = os.path.join(src, a.prompt_file)
        if not os.path.exists(pf):
            continue
        prompt = open(pf).read().strip()
        refs = [shrink(Image.open(os.path.join(src, "input.jpg")), a.reference_mp)]
        if a.second_reference:
            p = os.path.join(src, f"{a.second_reference}.png")
            if os.path.exists(p):
                refs.append(shrink(Image.open(p), a.reference_mp))
        with tempfile.TemporaryDirectory() as tmp:
            paths = []
            for i, r in enumerate(refs):
                paths.append(os.path.join(tmp, f"ref{i}.png"))
                r.save(paths[-1])
            t1 = time.time()
            kw = {"guidance": a.guidance} if a.guidance is not None else {}
            out = model.generate_image(
                seed=a.seed,
                prompt=prompt,
                num_inference_steps=a.steps,
                width=w,
                height=h,
                image_paths=paths,
                **kw,
            )
            dt = time.time() - t1
        out.image.save(os.path.join(a.out, f"{it}.png"))
        mx.clear_cache()
        times[it] = round(dt, 2)
        print(f"{it}: {dt:.1f}s", flush=True)
    vals = sorted(times.values())
    summary = {
        "model": a.model,
        "quantize": a.quantize,
        "steps": a.steps,
        "size": [w, h],
        "reference_mp": a.reference_mp,
        "second_reference": a.second_reference,
        "load_s": round(load_s, 1),
        "median_s": vals[len(vals) // 2] if vals else None,
        "max_s": vals[-1] if vals else None,
        "peak_gb": round(mx.get_peak_memory() / 2**30, 1),
        "times": times,
    }
    json.dump(summary, open(os.path.join(a.out, "times.json"), "w"), indent=2)
    print(json.dumps({k: v for k, v in summary.items() if k != "times"}), flush=True)


def shrink(img: Image.Image, megapixels: float) -> Image.Image:
    img = ImageOps.exif_transpose(img)
    if img.mode in ("RGBA", "LA"):
        bg = Image.new("RGB", img.size, (236, 236, 236))
        bg.paste(img, mask=img.split()[-1])
        img = bg
    img = img.convert("RGB")
    area = img.width * img.height
    target = megapixels * 1_000_000
    if area > target:
        s = math.sqrt(target / area)
        img = img.resize((max(16, round(img.width * s)), max(16, round(img.height * s))), Image.LANCZOS)
    return img


if __name__ == "__main__":
    sys.exit(main())
