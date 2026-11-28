"""The API's studio loop offline, to measure it on a dataset (services/api/scripts/studio-dataset.ts or the
VLM detection bench): klein makes the photo → the VLM reads it (attrs.py) and rules compare it with the
attributes the detection gave → retry with the fix; when the editor keeps failing on a garment laid out
whole, the last attempt restores the item's own cutout instead (restore.py).

    .mflux-venv/bin/python mlx/loop_bench.py <dataset-dir> <out-dir> [--attempts 3] [--only a,b]

Writes <out>/<item>.png (the first accepted attempt, else the last), <out>/attempts/<item>-<n>.png and
<out>/loop.json (per attempt: seconds, problems, fix).
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
import time

from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from attrs import TARGET_PRODUCT, attributes_prompt, compare_attributes, fix_from, item_aspect, parse_attributes  # noqa: E402
from bench import shrink  # noqa: E402
from restore import on_grey, restore_prompt, usable_cutout  # noqa: E402

KIND_STARTS = ("Flat lay", "Hollow 3D", "Professional footwear", "Professional bag", "Hosiery flat lay", "Professional accessory")


def with_fix(prompt: str, fix: str) -> str:
    """As buildStudioPrompt does: the fix after the item, its description and "Use only…", before the
    presentation instructions."""
    fix = fix.strip().rstrip(". ")
    if not fix:
        return prompt
    found = [i for i in (prompt.find(k, 20) for k in KIND_STARTS) if i > 0]
    i = min(found) if found else prompt.find(". ") + 2
    return f"{prompt[:i]}It must be exactly like this: {fix}. {prompt[i:]}"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("dataset")
    ap.add_argument("out")
    ap.add_argument("--attempts", type=int, default=3)
    ap.add_argument("--vlm", default="mlx-community/Qwen3.5-35B-A3B-4bit")
    ap.add_argument("--only", default="")
    ap.add_argument("--seed", type=int, default=1234)
    ap.add_argument("--no-restore", action="store_true")
    a = ap.parse_args()

    import mlx.core as mx
    from mflux.models.common.config import ModelConfig
    from mflux.models.flux2.variants import Flux2Klein, Flux2KleinEdit
    from mlx_vlm import generate as vlm_generate
    from mlx_vlm import load
    from mlx_vlm.prompt_utils import apply_chat_template

    mx.set_cache_limit(2 * 2**30)
    os.makedirs(os.path.join(a.out, "attempts"), exist_ok=True)
    klein = Flux2KleinEdit(model_config=ModelConfig.flux2_klein_4b(), quantize=None, compute_precision=mx.float16)
    img2img = Flux2Klein.__new__(Flux2Klein)  # the same weights, image-to-image (as the server does)
    dict.update(img2img, dict(klein))
    img2img.__dict__.update(klein.__dict__)
    vm, processor = load(a.vlm)
    mx.clear_cache()

    def read(path: str, expected: str) -> dict:
        q = attributes_prompt(TARGET_PRODUCT, expected)
        r = vlm_generate(vm, processor, apply_chat_template(processor, vm.config, q, num_images=1, enable_thinking=False), [path], max_tokens=300, temperature=0.0, verbose=False)
        mx.clear_cache()
        return parse_attributes(r.text if hasattr(r, "text") else str(r))

    log_path = os.path.join(a.out, "loop.json")
    log: dict = json.load(open(log_path)) if os.path.exists(log_path) else {}
    only = set(a.only.split(",")) - {""}
    for it in sorted(os.listdir(a.dataset)):
        src = os.path.join(a.dataset, it)
        if not os.path.isdir(src) or (only and it not in only) or it in log:
            continue
        meta = json.load(open(os.path.join(src, "meta.json")))
        vlm = meta.get("vlm") or {}
        original = vlm.get("attributes")
        partial = vlm.get("visible") == "partial"
        category = vlm.get("category", "top")
        base_prompt = open(os.path.join(src, "prompt.txt")).read().strip()
        cutout = os.path.join(src, "cutout.png")
        rows, chosen, fix, failed = [], None, "", False
        laid_out = (original or {}).get("worn") is False
        with tempfile.TemporaryDirectory() as tmp:
            rp, gp = os.path.join(tmp, "ref.png"), os.path.join(tmp, "gen.jpg")
            shrink(Image.open(os.path.join(src, "input.jpg")), 0.5).save(rp)
            for n in range(1, a.attempts + 1):
                # As the API: the last attempt restores the real cutout of an item nobody wears, seen whole,
                # when the editor keeps getting it wrong.
                restoring = (
                    n == a.attempts and n > 1 and failed and laid_out and not a.no_restore and not partial and os.path.exists(cutout)
                    and usable_cutout(Image.open(cutout))
                )
                t0 = time.time()
                if restoring:
                    sp = os.path.join(tmp, "start.png")
                    on_grey(Image.open(cutout), (832, 1040)).save(sp)
                    out = img2img.generate_image(
                        seed=a.seed + n, prompt=restore_prompt(vlm.get("name", "garment"), vlm.get("description", "")),
                        num_inference_steps=4, width=832, height=1040, image_path=sp, image_strength=0.65,
                    )
                else:
                    out = klein.generate_image(
                        seed=a.seed + n, prompt=with_fix(base_prompt, fix), num_inference_steps=4, width=832, height=1040, image_paths=[rp]
                    )
                gen_s = time.time() - t0
                img = out.image.convert("RGB")
                img.save(os.path.join(a.out, "attempts", f"{it}-{n}.png"))
                small = img.copy()
                small.thumbnail((768, 768))
                small.save(gp, quality=92)
                mx.clear_cache()
                t1 = time.time()
                length_unseen = bool(meta.get("bbox")) and (meta["bbox"][1] <= 0.01 or meta["bbox"][3] >= 0.99)
                # The restored photo is the real item: as in the API, it is not checked again.
                shown = {} if restoring else read(gp, (original or {}).get("kind") or vlm.get("name", "garment"))
                problems = (
                    compare_attributes(original, shown, partial=partial, category=category, aspect=item_aspect(img), length_unseen=length_unseen)
                    if original and not restoring
                    else []
                )
                rows.append({"n": n, "mode": "restore" if restoring else "edit", "gen_s": round(gen_s, 1), "verify_s": round(time.time() - t1, 1), "problems": problems, "shown": shown})
                print(f"{it} #{n} {'restore' if restoring else 'edit'}: gen {gen_s:.1f}s {problems}", flush=True)
                if not problems:
                    chosen = n
                    break
                fix = fix_from(original, problems, vlm.get("name", "garment").lower())
                # As the API: only another kind of item (or a whole other garment) leads to restoring.
                failed = failed or any(p.startswith(("another kind", "tails missing", "other garments added")) for p in problems)
        final = chosen or min(rows, key=lambda r: len(r["problems"]))["n"]
        Image.open(os.path.join(a.out, "attempts", f"{it}-{final}.png")).save(os.path.join(a.out, f"{it}.png"))
        log[it] = {"chosen": final, "verified": chosen is not None, "attempts": rows}
        json.dump(log, open(log_path, "w"), indent=1)
    ok = sum(1 for v in log.values() if v["verified"])
    print(f"verified {ok}/{len(log)}; attempts {sum(len(v['attempts']) for v in log.values())}")


if __name__ == "__main__":
    main()
