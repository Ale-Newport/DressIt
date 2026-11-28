"""Try-on benchmark on real photos, three methods:
- joint: Qwen-Image-Edit-2511, one pass with an outfit board;
- sequential: FASHN VTON v1.5 one garment at a time, maskless (dressed over), then a Qwen pass for
  shoes/accessories;
- masked: same, but the first garment of each region replaces the clothes there (Sapiens2
  clothing-agnostic image) — what the API does.

Metrics per outfit:
- per visible garment: CIEDE2000 between the mean colour of the garment's region in the render
  (Sapiens2 parsing) and the real garment's cutout, and FashionSigLIP cosine between both crops;
- identity proxy: FashionSigLIP cosine between the face+hair crops of the source photo and the render
  (a proxy, not face recognition: no biometric model is used);
- wall time per method.

Needs running: vision (8001), try-on (8002), ComfyUI (8188). Run from services/tryon:
  uv run python eval/benchmark.py --out <dir> --cases eval/cases.json
"""

from __future__ import annotations

import argparse
import io
import json
import random
import time
import urllib.request
import uuid
from pathlib import Path

import numpy as np
from PIL import Image

import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.parsing import crop_region, parse, region_mask  # noqa: E402

ROOT = Path(__file__).resolve().parents[3]
VISION = "http://127.0.0.1:8001"
TRYON = "http://127.0.0.1:8002"
COMFY = "http://127.0.0.1:8188"
SAPIENS = str(ROOT / "services/tryon/models/sapiens2-seg-0.4b")
WORKFLOWS = ROOT / "services/api/src/modules/imagegen/workflows"
REGION_OF = {
    "top": "upper",
    "outer": "upper",
    "one_piece": "upper",
    "bottom": "lower",
    "footwear": "shoes",
}
FASHN_CAT = {
    "top": "tops",
    "outer": "tops",
    "bottom": "bottoms",
    "one_piece": "one-pieces",
}
ORDER = {"bottom": 0, "one_piece": 0, "top": 1, "outer": 2}
# "masked-top": the base top first (it removes the old upper garment including its hem), then the
# bottom (which redraws the waist), then outer layers.
ORDER_TOP_FIRST = {"top": 0, "one_piece": 0, "bottom": 1, "outer": 2}


def multipart(fields: dict, files: dict) -> tuple[bytes, str]:
    boundary = uuid.uuid4().hex
    out = io.BytesIO()
    for k, v in fields.items():
        out.write(f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode())
    for k, (name, data) in files.items():
        out.write(f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"; filename="{name}"\r\nContent-Type: image/png\r\n\r\n'.encode())
        out.write(data)
        out.write(b"\r\n")
    out.write(f"--{boundary}--\r\n".encode())
    return out.getvalue(), f"multipart/form-data; boundary={boundary}"


def post(url: str, fields: dict, files: dict, timeout: int = 1800) -> tuple[bytes, dict]:
    body, ctype = multipart(fields, files)
    req = urllib.request.Request(url, data=body, headers={"content-type": ctype}, method="POST")
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read(), dict(r.headers)


def png(img: Image.Image) -> bytes:
    b = io.BytesIO()
    img.save(b, "PNG")
    return b.getvalue()


def on_white(img: Image.Image) -> Image.Image:
    rgba = img.convert("RGBA")
    bg = Image.new("RGBA", rgba.size, "white")
    bg.alpha_composite(rgba)
    return bg.convert("RGB")


def embed(img: Image.Image) -> np.ndarray:
    data, _ = post(
        f"{VISION}/v1/embed/image",
        {"segment": "false"},
        {"file": ("x.png", png(on_white(img)))},
    )
    return np.array(json.loads(data)["embedding"])


def cos(a: np.ndarray, b: np.ndarray) -> float:
    return float(a @ b / (np.linalg.norm(a) * np.linalg.norm(b)))


def _vision_colors():
    """services/vision/app/colors.py, loaded by path (both services have an ``app`` package)."""
    import importlib.util

    pkg = ROOT / "services/vision/app"
    spec = importlib.util.spec_from_file_location("vision_app", pkg / "__init__.py", submodule_search_locations=[str(pkg)])
    mod = importlib.util.module_from_spec(spec)
    sys.modules["vision_app"] = mod
    spec.loader.exec_module(mod)  # type: ignore[union-attr]
    return importlib.import_module("vision_app.colors")


COLORS = _vision_colors()


def mean_lab(img: Image.Image) -> np.ndarray:
    a = np.asarray(img.convert("RGBA")).astype(np.float64)
    m = a[..., 3] > 128
    return COLORS.rgb_to_lab(a[..., :3][m]).mean(axis=0)


def delta_e(a: np.ndarray, b: np.ndarray) -> float:
    return float(COLORS.delta_e2000(a, b))


# ---------------------------------------------------------------- generators
def comfy(workflow: str, images: dict[str, Image.Image], description: str, seed: int) -> Image.Image:
    names = {}
    for k, img in images.items():
        data, _ = post(
            f"{COMFY}/upload/image",
            {"type": "input", "overwrite": "true"},
            {"image": (f"bench-{k}-{seed}.png", png(img))},
        )
        names[k] = json.loads(data)["name"]
    wf = json.loads((WORKFLOWS / f"{workflow}.json").read_text())
    values = {**names, "DESCRIPTION": description, "SEED": seed}

    def fill(v):
        if isinstance(v, str):
            for k, x in values.items():
                if v == f"{{{{{k}}}}}":
                    return x
                v = v.replace(f"{{{{{k}}}}}", str(x))
            return v
        if isinstance(v, list):
            return [fill(i) for i in v]
        if isinstance(v, dict):
            return {k: fill(i) for k, i in v.items()}
        return v

    req = urllib.request.Request(
        f"{COMFY}/prompt",
        data=json.dumps({"prompt": fill(wf), "client_id": uuid.uuid4().hex}).encode(),
        headers={"content-type": "application/json"},
    )
    pid = json.loads(urllib.request.urlopen(req).read())["prompt_id"]
    while True:
        hist = json.loads(urllib.request.urlopen(f"{COMFY}/history/{pid}").read()).get(pid)
        if hist and hist.get("status", {}).get("completed"):
            img = [i for o in hist["outputs"].values() for i in o.get("images", [])][0]
            q = urllib.parse.urlencode(
                {
                    "filename": img["filename"],
                    "subfolder": img["subfolder"],
                    "type": img["type"],
                }
            )
            return Image.open(io.BytesIO(urllib.request.urlopen(f"{COMFY}/view?{q}").read())).convert("RGB")
        if hist and hist.get("status", {}).get("status_str") == "error":
            raise RuntimeError("ComfyUI error")
        time.sleep(2)


def board(garments: list[dict]) -> Image.Image:
    """Simple 2-column board on white (same idea as the API's flat-lay board)."""
    cells = [Image.open(g["path"]).convert("RGBA") for g in garments]
    W, H = 1024, 1280
    out = Image.new("RGBA", (W, H), "white")
    n = len(cells)
    rows = (n + 1) // 2
    cw, ch = W // 2, H // max(1, rows)
    for i, c in enumerate(cells):
        c.thumbnail((cw - 40, ch - 40))
        out.alpha_composite(
            c,
            ((i % 2) * cw + (cw - c.width) // 2, (i // 2) * ch + (ch - c.height) // 2),
        )
    return out.convert("RGB")


def describe(garments: list[dict]) -> str:
    return "; ".join(g["label"] for g in garments)


def run_joint(person: Image.Image, face: Image.Image, garments: list[dict], seed: int) -> Image.Image:
    visible = visible_set(garments)
    return comfy(
        "avatar",
        {"BODY_IMAGE": person, "OUTFIT_IMAGE": board(visible), "FACE_IMAGE": face},
        describe(visible),
        seed,
    )


def visible_set(garments: list[dict]) -> list[dict]:
    uppers = sorted(
        [g for g in garments if g["slot"] in ("top", "outer")],
        key=lambda g: -ORDER[g["slot"]],
    )
    lower = [g for g in garments if g["slot"] in ("bottom", "one_piece")]
    shoes = [g for g in garments if g["slot"] == "footwear"]
    acc = [g for g in garments if g["slot"] == "accessory"]
    return (uppers[:1] + lower[:1] + shoes[:1] + acc[:1])[:4]


PLACEMENT = {"footwear": ("feet", "on the feet"), "accessory": ("head", "on the head")}


def extras_of(garments: list[dict]) -> list[dict]:
    return [g for g in garments if g["slot"] in PLACEMENT]


def run_extras(cur: Image.Image, extras: list[dict], seed: int) -> Image.Image:
    """Shoes and a hat with Qwen-Image-Edit, kept only on the feet / head (like the API)."""
    description = "; ".join(f"{g['label']}, {PLACEMENT[g['slot']][1]}" for g in extras)
    edited = comfy("tryon-accessories", {"BODY_IMAGE": cur, "OUTFIT_IMAGE": board(extras)}, description, seed)
    regions = ",".join(sorted({PLACEMENT[g["slot"]][0] for g in extras}))
    data, _ = post(f"{TRYON}/v1/composite", {"regions": regions}, {"base": ("b.png", png(cur)), "edited": ("e.png", png(edited))})
    return Image.open(io.BytesIO(data)).convert("RGB")


def run_sequential(person: Image.Image, garments: list[dict], seed: int, steps: int, masked: bool = False, top_first: bool = False) -> tuple[Image.Image, list[Image.Image]]:
    """``masked``: the first garment of each region replaces what the photo shows there (Sapiens2
    clothing-agnostic image, like the API does); otherwise every garment is dressed over (maskless)."""
    order = ORDER_TOP_FIRST if top_first else ORDER
    clothes = sorted([g for g in garments if g["slot"] in FASHN_CAT], key=lambda g: order[g["slot"]])
    cur, stages = person, []
    upper_done = False
    for g in clothes:
        mask = masked and (g["slot"] in ("bottom", "one_piece") or not upper_done)
        upper_done = upper_done or g["slot"] in ("top", "outer", "one_piece")
        data, _ = post(
            f"{TRYON}/v1/tryon",
            {"category": FASHN_CAT[g["slot"]], "steps": str(steps), "seed": str(seed), "mask": "true" if mask else "false"},
            {
                "person": ("p.png", png(cur)),
                "garment": ("g.png", Path(g["path"]).read_bytes()),
            },
        )
        cur = Image.open(io.BytesIO(data)).convert("RGB")
        stages.append(cur)
    extras = extras_of(garments)
    if extras:
        cur = run_extras(cur, extras, seed)
        stages.append(cur)
    return cur, stages


# ---------------------------------------------------------------- metrics
def evaluate(source: Image.Image, render: Image.Image, garments: list[dict]) -> dict:
    labels = parse(render, SAPIENS)
    src_labels = parse(source, SAPIENS)
    res: dict = {"garments": []}
    for g in visible_set(garments):
        region = REGION_OF.get(g["slot"])
        if not region:
            res["garments"].append({"label": g["label"], "slot": g["slot"], "found": None})
            continue
        crop = crop_region(render, region_mask(labels, region))
        cut = Image.open(g["path"])
        if crop is None:
            res["garments"].append({"label": g["label"], "slot": g["slot"], "found": False})
            continue
        res["garments"].append(
            {
                "label": g["label"],
                "slot": g["slot"],
                "found": True,
                "delta_e": round(delta_e(mean_lab(crop), mean_lab(cut)), 2),
                "similarity": round(cos(embed(crop), embed(cut)), 3),
            }
        )
    f_src = crop_region(source, region_mask(src_labels, "face"))
    f_out = crop_region(render, region_mask(labels, "face"))
    res["identity_proxy"] = round(cos(embed(f_src), embed(f_out)), 3) if f_src and f_out else None
    found = [g for g in res["garments"] if g.get("found")]
    res["mean_delta_e"] = round(float(np.mean([g["delta_e"] for g in found])), 2) if found else None
    res["mean_similarity"] = round(float(np.mean([g["similarity"] for g in found])), 3) if found else None
    res["missing"] = sum(1 for g in res["garments"] if g.get("found") is False)
    return res


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--cases", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--steps", type=int, default=20)
    ap.add_argument("--methods", default="joint,sequential,masked")
    ap.add_argument("--redo-extras", action="store_true", help="re-run only the shoes/accessory pass from the saved garment steps")
    args = ap.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    cases = json.loads(Path(args.cases).read_text())
    results = []
    for case in cases:
        person = Image.open(case["person"]).convert("RGB")
        face = person.crop(
            tuple(
                int(v * s)
                for v, s in zip(
                    case["face_box"],
                    (person.width, person.height, person.width, person.height),
                )
            )
        )
        seed = random.Random(case["id"]).randint(1, 2**31 - 1)
        row = {"id": case["id"], "items": len(case["garments"])}
        renders = {"source": person}
        for method in args.methods.split(","):
            final = out / f"{case['id']}-{method}.png"
            timing = out / f"{case['id']}-{method}.seconds"
            clothes_steps = sum(1 for g in case["garments"] if g["slot"] in FASHN_CAT)
            if args.redo_extras and method != "joint" and extras_of(case["garments"]) and final.exists():
                v1 = out / f"{case['id']}-{method}-extras-v1.png"
                if not v1.exists():
                    v1.write_bytes(final.read_bytes())
                t = time.perf_counter()
                before = Image.open(out / f"{case['id']}-{method}-step{clothes_steps}.jpg").convert("RGB")
                img = run_extras(before, extras_of(case["garments"]), seed)
                img.save(out / f"{case['id']}-{method}-step{clothes_steps + 1}.jpg", quality=90)
                # The total keeps the original run's time (same Qwen pass cost); the redone pass, with
                # its composite, is timed on its own.
                seconds = float(timing.read_text())
                (out / f"{case['id']}-{method}.extras_seconds").write_text(str(round(time.perf_counter() - t, 1)))
                img.save(final)
            elif final.exists() and timing.exists():  # re-run of the metrics only: keep the render and its time
                img, seconds = (
                    Image.open(final).convert("RGB"),
                    float(timing.read_text()),
                )
            else:
                t = time.perf_counter()
                if method == "joint":
                    img = run_joint(person, face, case["garments"], seed)
                else:
                    img, stages = run_sequential(person, case["garments"], seed, args.steps, masked=method.startswith("masked"), top_first=method == "masked-top")
                    for i, s in enumerate(stages):
                        s.save(out / f"{case['id']}-{method}-step{i + 1}.jpg", quality=90)
                seconds = round(time.perf_counter() - t, 1)
                img.save(final)
                timing.write_text(str(seconds))
            row[method] = {
                "seconds": seconds,
                **evaluate(person, img, case["garments"]),
            }
            renders[method] = img
            print(
                case["id"],
                method,
                json.dumps(row[method], ensure_ascii=False),
                flush=True,
            )
        h = 640
        tiles = [r.resize((int(r.width * h / r.height), h)) for r in renders.values()]
        sheet = Image.new("RGB", (sum(t.width for t in tiles) + 12 * len(tiles), h), "#ddd")
        x = 0
        for tile in tiles:
            sheet.paste(tile, (x, 0))
            x += tile.width + 12
        sheet.save(out / f"{case['id']}-sheet.jpg", quality=85)
        results.append(row)
        (out / "results.json").write_text(json.dumps(results, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
