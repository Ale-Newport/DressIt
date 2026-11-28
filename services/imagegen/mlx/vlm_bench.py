"""Garment detection with a given vision-language model on the evaluation photos:

    .mflux-venv/bin/python mlx/vlm_bench.py <model-id> <out-dir> <photo.jpg> [<photo.jpg> …]

Writes <out>/<photo>.json (the cleaned items and seconds) and <out>/<photo>.jpg (the boxes drawn).
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
import time

from PIL import Image, ImageDraw, ImageOps

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from garments import GARMENTS_PROMPT, clean_garments  # noqa: E402


def main() -> None:
    model_id, out, *photos = sys.argv[1:]
    os.makedirs(out, exist_ok=True)
    import mlx.core as mx
    from mlx_vlm import generate, load
    from mlx_vlm.prompt_utils import apply_chat_template

    mx.set_cache_limit(2 * 2**30)
    t0 = time.time()
    m, processor = load(model_id)
    print(f"loaded in {time.time() - t0:.1f}s", flush=True)
    prompt_text = os.environ.get("PROMPT_FILE")
    question = open(prompt_text).read() if prompt_text else GARMENTS_PROMPT
    for p in photos:
        name = os.path.splitext(os.path.basename(p))[0]
        img = ImageOps.exif_transpose(Image.open(p)).convert("RGB")
        img.thumbnail((1024, 1024))
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "photo.jpg")
            img.save(path, quality=92)
            prompt = apply_chat_template(processor, m.config, question, num_images=1, enable_thinking=False)
            t1 = time.time()
            res = generate(m, processor, prompt, [path], max_tokens=1800, temperature=0.0, verbose=False)
            dt = time.time() - t1
        text = res.text if hasattr(res, "text") else str(res)
        try:
            items = clean_garments(text)
        except ValueError:
            items = []
        json.dump({"seconds": round(dt, 1), "items": items, "raw": text}, open(f"{out}/{name}.json", "w"), indent=1)
        d = ImageDraw.Draw(img)
        for i, it in enumerate(items):
            b = it["box"]
            xy = [b[0] * img.width, b[1] * img.height, b[2] * img.width, b[3] * img.height]
            d.rectangle(xy, outline=(255, 0, 0), width=3)
            d.text((xy[0] + 4, xy[1] + 4), f"{i} {it['name']} ({it['visible']})", fill=(255, 255, 0))
        img.save(f"{out}/{name}.jpg", quality=85)
        print(f"{name}: {dt:.1f}s {[(it['name'], it['visible']) for it in items]}", flush=True)
        mx.clear_cache()


if __name__ == "__main__":
    main()
