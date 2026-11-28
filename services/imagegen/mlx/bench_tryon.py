"""Try-on bench with FLUX.2 klein 4B (multi-reference editing): a person's photo + garment photos → the
same person wearing them, in one pass.

    .mflux-venv/bin/python mlx/bench_tryon.py cases.json <out-dir> [--steps 4] [--person-mp 0.6]
        [--garment-mp 0.25] [--output-mp 0.6] [--seed 7] [--only name,name]
    .mflux-venv/bin/python mlx/bench_tryon.py --people people.json <out-dir>   # synthetic test people

cases.json: [{"name": str, "person": path, "garments": [{"image": path, "label": "black polo shirt"}]}]
people.json: [{"name": str, "prompt": str, "width": int, "height": int}]
The prompt is built as the API builds it (services/api/src/modules/imagegen/tryon-prompt.ts) unless the
case gives one. Writes <out>/<name>.png and <out>/times.json.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import tempfile
import time

from PIL import Image, ImageOps


def tryon_prompt(labels: list[str]) -> str:
    """Same text as services/api/src/modules/imagegen/tryon-prompt.ts (keep both in step)."""
    pieces = "; ".join(f"the {label} shown in image {i + 2}" for i, label in enumerate(labels))
    return (
        f"The person from image 1 wearing this outfit: {pieces}. Take off every piece of clothing image 1 shows "
        "where a new garment goes (a top replaces their top, a skirt, shorts or trousers replace their trousers, "
        "leggings or skirt, shoes replace their shoes) and dress them in exactly these garments; each garment "
        "keeps the colours, print, fabric, length, fit and details of its image, worn naturally with realistic "
        "folds. Keep the person exactly as in "
        "image 1: the same face and facial features, hairstyle and hair colour, skin tone, body shape and "
        "proportions, height, pose, expression, camera angle, framing, lighting and background; anyone or "
        "anything else in image 1 stays unchanged. No other clothes or accessories than these and those image 1 "
        "already shows that the outfit does not replace."
    )


def shrink(img: Image.Image, megapixels: float) -> Image.Image:
    img = ImageOps.exif_transpose(img)
    if img.mode in ("RGBA", "LA", "P"):
        img = img.convert("RGBA")
        bg = Image.new("RGB", img.size, (236, 236, 236))
        bg.paste(img, mask=img.split()[-1])
        img = bg
    img = img.convert("RGB")
    s = math.sqrt(megapixels * 1_000_000 / (img.width * img.height))
    if s < 1:
        img = img.resize((max(16, round(img.width * s)), max(16, round(img.height * s))), Image.LANCZOS)
    return img


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("cases", nargs="?")
    ap.add_argument("out")
    ap.add_argument("--people", default="")
    ap.add_argument("--quantize", type=int, default=8)
    ap.add_argument("--steps", type=int, default=4)
    ap.add_argument("--person-mp", type=float, default=0.45)
    ap.add_argument("--garment-mp", type=float, default=0.15)
    ap.add_argument("--output-mp", type=float, default=0.5)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--only", default="")
    ap.add_argument("--kv", action="store_true", help="cache the references' attention keys/values after step 1")
    a = ap.parse_args()

    import mlx.core as mx
    from mflux.models.common.config import ModelConfig
    from mflux.models.flux2.variants import Flux2Klein, Flux2KleinEdit

    mx.set_cache_limit(2 * 2**30)
    os.makedirs(a.out, exist_ok=True)
    model = (Flux2Klein if a.people else Flux2KleinEdit)(
        model_config=ModelConfig.flux2_klein_4b(), quantize=a.quantize or None, compute_precision=mx.float16
    )
    mx.clear_cache()
    times: dict[str, float] = {}
    if a.people:
        for p in json.load(open(a.people)):
            t0 = time.time()
            out = model.generate_image(
                seed=a.seed, prompt=p["prompt"], num_inference_steps=a.steps, width=p.get("width", 768), height=p.get("height", 1152)
            )
            times[p["name"]] = round(time.time() - t0, 1)
            out.image.save(os.path.join(a.out, f"{p['name']}.png"))
            mx.clear_cache()
            print(f"{p['name']}: {times[p['name']]}s", flush=True)
        json.dump(times, open(os.path.join(a.out, "times.json"), "w"), indent=1)
        return
    only = set(a.only.split(",")) - {""}
    for case in json.load(open(a.cases)):
        if only and case["name"] not in only:
            continue
        person = shrink(Image.open(case["person"]), a.person_mp)
        refs = [person] + [shrink(Image.open(g["image"]), a.garment_mp) for g in case["garments"]]
        prompt = case.get("prompt") or tryon_prompt([g["label"] for g in case["garments"]])
        s = math.sqrt(a.output_mp * 1_000_000 / (person.width * person.height))
        w, h = round(person.width * s) // 16 * 16, round(person.height * s) // 16 * 16
        with tempfile.TemporaryDirectory() as tmp:
            paths = []
            for i, r in enumerate(refs):
                paths.append(os.path.join(tmp, f"ref{i}.png"))
                r.save(paths[-1])
            t0 = time.time()
            out = model.generate_image(
                seed=a.seed, prompt=prompt, num_inference_steps=a.steps, width=w, height=h, image_paths=paths,
                **({"use_kv_cache": True} if a.kv else {}),
            )
            dt = time.time() - t0
        out.image.save(os.path.join(a.out, f"{case['name']}.png"))
        mx.clear_cache()
        times[case["name"]] = round(dt, 1)
        print(f"{case['name']}: {dt:.1f}s ({len(refs) - 1} garments, {w}x{h})", flush=True)
    vals = sorted(times.values())
    json.dump(
        {"median_s": vals[len(vals) // 2] if vals else None, "max_s": vals[-1] if vals else None, "times": times},
        open(os.path.join(a.out, "times.json"), "w"),
        indent=1,
    )


if __name__ == "__main__":
    main()
