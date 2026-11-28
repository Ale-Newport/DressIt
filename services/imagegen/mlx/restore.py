"""'Restore' studio photo for items the editor cannot redraw (a tailcoat drawn as a suit): the item's own
cutout on the studio grey, cleaned by klein in img2img (it keeps the shape, it cannot invent another item).
mflux's image_strength is the share of the start image kept: 0.65 keeps the item, 0.45 redraws it.

    .mflux-venv/bin/python mlx/restore.py <dataset-dir> <out-dir> --only a,b [--strength 0.65]
"""

from __future__ import annotations

import argparse
import json
import os
import tempfile
import time

from PIL import Image


def on_grey(cutout: Image.Image, size: tuple[int, int], fill: float = 0.86) -> Image.Image:
    """The cutout centred on a light grey canvas of `size`, filling `fill` of it."""
    c = cutout.convert("RGBA")
    box = c.getbbox()
    if box:
        c = c.crop(box)
    W, H = size
    s = min(W * fill / c.width, H * fill / c.height)
    c = c.resize((max(1, round(c.width * s)), max(1, round(c.height * s))), Image.LANCZOS)
    bg = Image.new("RGB", size, (236, 236, 236))
    bg.paste(c, ((W - c.width) // 2, (H - c.height) // 2), mask=c.split()[-1])
    return bg


def usable_cutout(cutout: Image.Image, min_main: float = 0.9) -> bool:
    """A cutout worth restoring is one solid piece: the main part holds most of it (a quilted bag whose
    chain split its cutout in three came out as loose fragments)."""
    import numpy as np
    from scipy import ndimage

    alpha = np.array(cutout.convert("RGBA"))[:, :, 3] > 32
    labels, n = ndimage.label(alpha)
    if n == 0:
        return False
    sizes = np.bincount(labels.ravel())[1:]
    return float(sizes.max() / sizes.sum()) >= min_main


def restore_prompt(name: str, description: str) -> str:
    return (
        f"Professional e-commerce studio product photo of this exact {name}: {description.rstrip('.')}. "
        "Keep its exact shape, layout, proportions, colours, fabric, buttons and every detail as it is; only "
        "smooth the wrinkles, even out the lighting and clean the edges. Plain, seamless, evenly lit very light "
        "grey (almost white) studio background, no cast shadow, no person, nothing else. Sharp, high resolution."
    )


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("dataset")
    ap.add_argument("out")
    ap.add_argument("--only", default="")
    ap.add_argument("--strength", type=float, default=0.65)
    ap.add_argument("--steps", type=int, default=4)
    ap.add_argument("--seed", type=int, default=7)
    a = ap.parse_args()

    import mlx.core as mx
    from mflux.models.common.config import ModelConfig
    from mflux.models.flux2.variants import Flux2Klein

    os.makedirs(a.out, exist_ok=True)
    model = Flux2Klein(model_config=ModelConfig.flux2_klein_4b(), quantize=None, compute_precision=mx.float16)
    only = set(a.only.split(",")) - {""}
    for it in sorted(os.listdir(a.dataset)):
        src = os.path.join(a.dataset, it)
        if (only and it not in only) or not os.path.exists(os.path.join(src, "cutout.png")):
            continue
        meta = json.load(open(os.path.join(src, "meta.json")))
        vlm = meta.get("vlm") or {}
        start = on_grey(Image.open(os.path.join(src, "cutout.png")), (832, 1040))
        with tempfile.TemporaryDirectory() as tmp:
            p = os.path.join(tmp, "start.png")
            start.save(p)
            t0 = time.time()
            out = model.generate_image(
                seed=a.seed, prompt=restore_prompt(vlm.get("name", "garment"), vlm.get("description", "")),
                num_inference_steps=a.steps, width=832, height=1040, image_path=p, image_strength=a.strength,
            )
            dt = time.time() - t0
        start.save(os.path.join(a.out, f"{it}.start.png"))
        out.image.save(os.path.join(a.out, f"{it}.png"))
        mx.clear_cache()
        print(f"{it}: {dt:.1f}s", flush=True)


if __name__ == "__main__":
    main()
