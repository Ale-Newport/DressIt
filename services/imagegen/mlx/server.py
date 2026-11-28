"""Studio-photo and try-on server on Apple Silicon without ComfyUI, everything local and free (Apache-2.0 weights):

- FLUX.2 klein 4B run natively in MLX with mflux (fp16, unquantised: 14–20 s per studio photo, 20–23 s
  per try-on on an M2 Max), the image editor that makes the studio photo and dresses the user;
- Qwen3.5-35B-A3B (4-bit, mlx-vlm), a vision-language model that finds every garment in a photo and
  describes the COMPLETE item as a shop would ("red zip-up hoodie with a dark grey lined hood…"), names
  the one marked with a red rectangle, and compares a studio photo with the user's photo. The editor
  draws what the prompt names, so a precise description matters more than anything else in the prompt.

Both are loaded once and kept in memory.

    POST /v1/garments {"image": <base64 JPEG/PNG of the whole photo>}
                    → {"items": [{"box": [x0, y0, x1, y1] (0–1), "name", "name_es", "description",
                                   "category", "visible": "whole"|"partial", "attributes"}], "seconds": float}
    POST /v1/identify {"image": <base64 studio photo of one item>} → {"name", "colour", "category", ...}
                    (what a generated photo actually shows, to check it against the garment)
    POST /v1/describe {"image": <base64 JPEG/PNG with the item inside a red rectangle>}
                    → {"name": str, "colour": str, "category": str, "whole": bool, "seconds": float}
    POST /v1/verify {"photo": <base64, the garment in a red rectangle>, "image": <base64 studio photo>,
                     "name": str, "category": str, "partial": bool, "original": <attributes, optional>}
                    → {"ok": bool, "problems": [str], "fix": str, "original": {...}, "shown": {...}}
    POST /v1/tryon/check {"image": <base64 try-on render>, "labels": [str, … up to 4]}
                    → {"worn": [bool per garment], "ok": bool}
    POST /v1/restore {"cutout": <base64 PNG with alpha>, "name": str, "description": str, "strength": 0.65}
                    → image/png (the item's own cutout cleaned into a studio photo)
    POST /v1/edit   {"image": <base64 JPEG/PNG>, "prompt": str, "seed": int, "width": int, "height": int,
                     "steps": int = 4, "reference_mp": float = 0.5}
                    → image/png (the generated studio photo)
    POST /v1/tryon  {"person": <base64>, "garments": [<base64>, … up to 4], "prompt": str, "seed": int,
                     "person_mp": 0.45, "garment_mp": 0.15, "output_mp": 0.5}
                    → image/png (the person wearing the garments)
    GET  /health    → {"ok": true, "model": ..., "loaded": bool}

One generation at a time (one GPU, one worker thread): concurrent requests wait in line, so the API can send several
garments at once without overloading the Mac. Started by services/imagegen/run-mlx.sh.
"""

from __future__ import annotations

import base64
import io
import json
import math
import os
import sys
import tempfile
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from PIL import Image, ImageOps

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from attrs import TARGET_MARKED, TARGET_PRODUCT, attributes_prompt, compare_attributes, fix_from, item_aspect, parse_attributes
from garments import GARMENTS_PROMPT, TRANSLATE_PROMPT, TRYON_CHECK_PROMPT, clean_garments, looks_spanish, parse_worn

MODEL_NAME = "FLUX.2 klein 4B (MLX)"
QUANTIZE = int(os.environ.get("MLX_QUANTIZE", "0")) or None  # fp16, unquantised: fastest and best (14 s vs 16 s q8)
SMALL_TEXT_ENCODER = os.environ.get("MLX_SMALL_TEXT_ENCODER", "0") == "1"
MAX_PIXELS = 1536 * 1536
MAX_TRYON_GARMENTS = 4

# Qwen3.5-35B-A3B (4-bit, 20 GB, Apache-2.0): a mixture of experts with 3B active parameters, as fast as
# the 4B (4–14 s per photo) and far better at finding and describing garments: the 4B wrote English
# fields in Spanish, missed lengths ("very short shorts") and listed hangers and reflections.
VLM_ID = os.environ.get("MLX_VLM", "mlx-community/Qwen3.5-35B-A3B-4bit")
DESCRIBE_PROMPT = (
    "Look only at the item inside the red rectangle. If the rectangle holds several clothes, choose the single "
    "item that fills most of the rectangle. Ignore everything else, including people. Describe ONLY that one item "
    "as a shop would list it. Reply with JSON only: "
    '{"name": "<2-5 word product name with colour, material if obvious, and type, e.g. Red Hooded Sweatshirt, '
    'Tan Corduroy Wide Leg Pants; plain colour words as the item looks (tan or olive, never khaki)>", "colour": "<main colour, one or two plain words, as the item really is '
    '(black stays black even if lit by flash)>", "category": "<top|bottom|one_piece|outerwear|footwear|accessory|not_clothing>", '
    '"whole": <true if the rectangle shows one complete item; false if it shows only a small fragment of an item, '
    "or a pile or jumble of several things where no single item can be told apart>}"
)

# MLX keeps freed GPU buffers in a cache that otherwise grows to the peak of every model and image
# (31 GB measured with klein q8 + the VLM): capped and emptied after each job.
CACHE_LIMIT = int(float(os.environ.get("MLX_CACHE_GB", "2")) * 2**30)

IDENTIFY_PROMPT = (
    "This is a studio photo of one clothing item or accessory. Reply with JSON only: "
    '{"name": "<2-5 word product name with colour and type, e.g. Red Hooded Sweatshirt, Black Pointed Toe Heels>", '
    '"colour": "<main colour in plain words>", '
    '"category": "<top|bottom|one_piece|outerwear|footwear|accessory|swimwear|not_clothing>", "whole": true}'
)

_model = None
_vlm = None
_load_lock = threading.Lock()
# MLX streams belong to the thread that created them: the model is loaded and every image generated
# on this one worker thread, which also makes generations run one at a time (one GPU).
_worker = ThreadPoolExecutor(max_workers=1, thread_name_prefix="mlx")


def _release() -> None:
    import mlx.core as mx

    mx.clear_cache()


def model():
    global _model
    with _load_lock:
        if _model is None:
            import mlx.core as mx

            mx.set_cache_limit(CACHE_LIMIT)
            from mflux.models.common.config import ModelConfig
            from mflux.models.flux2.variants import Flux2KleinEdit

            t0 = time.time()
            _model = Flux2KleinEdit(
                model_config=ModelConfig.flux2_klein_4b(),
                quantize=QUANTIZE,
                compute_precision=mx.float16
                if os.environ.get("MLX_FP16", "1") == "1"
                else None,
                small_text_encoder=SMALL_TEXT_ENCODER,
            )
            _release()  # the bf16 weights that quantisation replaced
            print(
                f"[mlx] model loaded in {time.time() - t0:.1f}s (q={QUANTIZE})",
                flush=True,
            )
        return _model


_img2img = None


def img2img_model():
    """klein for image-to-image (the 'restore' photo), sharing the editor's loaded weights: the
    text-to-image class starts from a given image, the editor does not."""
    global _img2img
    if _img2img is None:
        from mflux.models.flux2.variants import Flux2Klein

        edit = model()
        shell = Flux2Klein.__new__(Flux2Klein)
        dict.update(shell, dict(edit))  # the submodules (transformer, VAE, text encoder)
        shell.__dict__.update(edit.__dict__)  # config, tiling, callbacks, prompt cache
        _img2img = shell
    return _img2img


def vlm():
    global _vlm
    with _load_lock:
        if _vlm is None:
            from mlx_vlm import load

            t0 = time.time()
            _vlm = load(VLM_ID)
            _release()
            print(f"[mlx] VLM {VLM_ID} loaded in {time.time() - t0:.1f}s", flush=True)
        return _vlm


def parse_description(text: str) -> dict:
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end <= start:
        raise ValueError("no JSON in the VLM answer")
    d = json.loads(text[start : end + 1])
    # A JSON null is "no answer", not the word "None".
    out: dict = {
        k: ("" if d.get(k) is None else str(d.get(k)).strip()[:80])
        for k in ("name", "colour", "category")
    }
    if not out["name"]:
        raise ValueError("no name in the VLM answer")
    whole = d.get("whole")
    out["whole"] = (
        whole if isinstance(whole, bool) else str(whole).strip().lower() != "false"
    )
    return out


def describe(body: dict) -> dict:
    if VLM_ID == "none":  # refuse at once, without waiting behind generations
        raise ValueError("the garment describer is disabled (MLX_VLM=none)")
    return _worker.submit(_describe, body).result()


def _vlm_image(image_b64: str, side: int) -> Image.Image:
    img = Image.open(io.BytesIO(base64.b64decode(image_b64)))
    img = ImageOps.exif_transpose(img)
    if img.mode in ("RGBA", "LA", "P"):
        img = img.convert("RGBA")
        bg = Image.new("RGB", img.size, (236, 236, 236))  # a cutout, on the studio grey
        bg.paste(img, mask=img.split()[-1])
        img = bg
    img = img.convert("RGB")
    img.thumbnail((side, side))
    return img


def _ask_vlm(image_b64: str | list[str], question: str, max_tokens: int) -> tuple[str, float]:
    """One deterministic answer of the VLM about one or more images (runs on the worker thread)."""
    from mlx_vlm import generate as vlm_generate
    from mlx_vlm.prompt_utils import apply_chat_template

    if VLM_ID == "none":
        raise ValueError("the garment describer is disabled (MLX_VLM=none)")
    images = [image_b64] if isinstance(image_b64, str) else image_b64
    imgs = [_vlm_image(b, 1024 if len(images) == 1 else 768) for b in images]
    m, processor = vlm()
    # Qwen3.5 reasons aloud before answering unless thinking is off; the answer must be JSON only.
    extra = {"enable_thinking": False} if "qwen" in VLM_ID.lower() else {}
    with tempfile.TemporaryDirectory() as tmp:
        paths = []
        for i, img in enumerate(imgs):
            paths.append(os.path.join(tmp, f"photo{i}.jpg"))
            img.save(paths[-1], quality=92)
        t0 = time.time()
        prompt = apply_chat_template(
            processor, m.config, question, num_images=len(paths), **extra
        )
        out = vlm_generate(
            m,
            processor,
            prompt,
            paths or None,
            max_tokens=max_tokens,
            temperature=0.0,
            verbose=False,
        )
    text = out.text if hasattr(out, "text") else str(out)
    _release()
    return text, round(time.time() - t0, 2)


def _describe(body: dict) -> dict:
    text, dt = _ask_vlm(body["image"], DESCRIBE_PROMPT, 160)
    return {**parse_description(text), "seconds": dt}


def identify(body: dict) -> dict:
    if VLM_ID == "none":
        raise ValueError("the garment describer is disabled (MLX_VLM=none)")
    return _worker.submit(_identify, body).result()


def _identify(body: dict) -> dict:
    text, dt = _ask_vlm(body["image"], IDENTIFY_PROMPT, 120)
    return {**parse_description(text), "seconds": dt}


def verify(body: dict) -> dict:
    if VLM_ID == "none":
        raise ValueError("the garment describer is disabled (MLX_VLM=none)")
    return _worker.submit(_verify, body).result()


def _verify(body: dict) -> dict:
    """What the studio photo got wrong against the user's photo (the garment in a red rectangle). The model
    reads each image on its own (length, sleeves, hood, laces, large prints, lace, hatband) and rules
    compare them: shown two images at once, it reported differences that were not there."""
    t0 = time.time()
    name = str(body.get("name") or "garment")[:80].lower()
    original = body.get("original")
    if not isinstance(original, dict):
        text, _ = _ask_vlm(body["photo"], attributes_prompt(TARGET_MARKED, name), 300)
        original = parse_attributes(text)
    original = {**original, "kind": str(original.get("kind") or name)[:60].lower()}
    text, _ = _ask_vlm(body["image"], attributes_prompt(TARGET_PRODUCT, original["kind"]), 300)
    shown = parse_attributes(text)
    studio = ImageOps.exif_transpose(Image.open(io.BytesIO(base64.b64decode(body["image"]))))
    problems = compare_attributes(
        original,
        shown,
        partial=bool(body.get("partial")),
        category=str(body.get("category") or "top"),
        aspect=item_aspect(studio),
        length_unseen=bool(body.get("length_unseen")),
    )
    return {
        "ok": not problems,
        "problems": problems,
        "fix": fix_from(original, problems, name),
        "original": original,
        "shown": shown,
        "seconds": round(time.time() - t0, 2),
    }


def tryon_check(body: dict) -> dict:
    if VLM_ID == "none":
        raise ValueError("the garment describer is disabled (MLX_VLM=none)")
    return _worker.submit(_tryon_check, body).result()


def _tryon_check(body: dict) -> dict:
    """Which garments of the outfit the person in a try-on render actually wears."""
    labels = [str(x)[:80] for x in (body.get("labels") or [])][:4]
    if not labels:
        raise ValueError("labels required")
    items = "; ".join(f"{i + 1}) {label}" for i, label in enumerate(labels))
    text, dt = _ask_vlm(body["image"], TRYON_CHECK_PROMPT.replace("{ITEMS}", items), 120)
    worn = parse_worn(text, len(labels))
    return {"worn": worn, "ok": all(worn), "seconds": dt}


def restore(body: dict) -> tuple[bytes, float]:
    return _worker.submit(_restore, body).result()


def _restore(body: dict) -> tuple[bytes, float]:
    """The item's own cutout on the studio grey, cleaned by klein image-to-image: it keeps the item's
    shape, so it cannot become another item (klein drew a tailcoat as a suit however it was described)."""
    from restore import on_grey, restore_prompt, usable_cutout

    cut = Image.open(io.BytesIO(base64.b64decode(body["cutout"])))
    if not usable_cutout(cut):
        raise UnusableCutout("the cutout is in pieces: nothing to restore")
    start = on_grey(cut, (832, 1040))
    strength = float(body.get("strength", 0.65))
    if not 0.3 <= strength <= 0.9:
        raise ValueError("strength between 0.3 and 0.9")
    m = img2img_model()
    with tempfile.TemporaryDirectory() as tmp:
        p = os.path.join(tmp, "start.png")
        start.save(p)
        t0 = time.time()
        out = m.generate_image(
            seed=int(body.get("seed", 0)),
            prompt=restore_prompt(str(body.get("name") or "garment")[:80], str(body.get("description") or "")[:400]),
            num_inference_steps=4,
            width=832,
            height=1040,
            image_path=p,
            image_strength=strength,
        )
        dt = time.time() - t0
    buf = io.BytesIO()
    out.image.save(buf, format="PNG")
    _release()
    return buf.getvalue(), dt


def garments(body: dict) -> dict:
    if VLM_ID == "none":
        raise ValueError("the garment describer is disabled (MLX_VLM=none)")
    return _worker.submit(_garments, body).result()


def _garments(body: dict) -> dict:
    text, dt = _ask_vlm(body["image"], GARMENTS_PROMPT, 1800)
    items = clean_garments(text)
    # The editor only understands English: a name or description written in Spanish is translated.
    for it in items:
        if looks_spanish(it["name"]) or looks_spanish(it["description"]):
            try:
                t, _ = _ask_vlm(
                    [],
                    TRANSLATE_PROMPT.replace("{NAME}", it["name"]).replace("{DESCRIPTION}", it["description"]),
                    300,
                )
                d = json.loads(t[t.find("{") : t.rfind("}") + 1])
                if str(d.get("name") or "").strip() and not looks_spanish(str(d["name"])):
                    it["name"] = str(d["name"]).strip()[:80]
                    it["description"] = str(d.get("description") or it["description"]).strip()[:400]
            except (ValueError, json.JSONDecodeError):
                pass
    return {"items": items, "seconds": dt}


def reference(image_bytes: bytes, megapixels: float) -> Image.Image:
    img = ImageOps.exif_transpose(Image.open(io.BytesIO(image_bytes))).convert("RGB")
    if img.width * img.height > MAX_PIXELS * 4:
        raise ValueError("image too large")
    area = img.width * img.height
    target = megapixels * 1_000_000
    if area > target:
        s = math.sqrt(target / area)
        img = img.resize(
            (max(16, round(img.width * s)), max(16, round(img.height * s))),
            Image.LANCZOS,
        )
    return img


def generate(body: dict) -> tuple[bytes, float]:
    return _worker.submit(_generate, body).result()


def _generate(body: dict) -> tuple[bytes, float]:
    ref = reference(
        base64.b64decode(body["image"]), float(body.get("reference_mp", 0.5))
    )
    return _edit(body, [ref], 832, 1040)


def tryon(body: dict) -> tuple[bytes, float]:
    return _worker.submit(_tryon, body).result()


def _tryon(body: dict) -> tuple[bytes, float]:
    """The person of the first image wearing the garments of the others, in one pass (multi-reference
    editing): the person's photo leads, so face, body, pose and background are kept from it."""
    garments = body.get("garments") or []
    if not isinstance(garments, list) or not 1 <= len(garments) <= MAX_TRYON_GARMENTS:
        raise ValueError(f"between 1 and {MAX_TRYON_GARMENTS} garment images")
    person = reference(
        base64.b64decode(body["person"]), float(body.get("person_mp", 0.45))
    )
    refs = [person] + [
        reference(base64.b64decode(g), float(body.get("garment_mp", 0.15)))
        for g in garments
    ]
    # The output keeps the person's framing: same aspect ratio, ~0.5 MP unless asked otherwise. These
    # sizes keep 4 garments under ~23 s on an M2 Max (0.6 / 0.25 / 0.6 MP took 36 s, the same quality).
    s = math.sqrt(float(body.get("output_mp", 0.5)) * 1_000_000 / (person.width * person.height))
    return _edit(body, refs, round(person.width * s), round(person.height * s))


def _edit(body: dict, refs: list[Image.Image], width: int, height: int) -> tuple[bytes, float]:
    prompt = str(body["prompt"])
    seed = int(body.get("seed", 0))
    width = int(body.get("width", width)) // 16 * 16
    height = int(body.get("height", height)) // 16 * 16
    steps = int(body.get("steps", 4))
    if width * height > MAX_PIXELS or not (1 <= steps <= 12):
        raise ValueError("bad size or steps")
    m = model()
    with tempfile.TemporaryDirectory() as tmp:
        paths = []
        for i, r in enumerate(refs):
            paths.append(os.path.join(tmp, f"ref{i}.png"))
            r.save(paths[-1])
        t0 = time.time()
        out = m.generate_image(
            seed=seed,
            prompt=prompt,
            num_inference_steps=steps,
            width=width,
            height=height,
            image_paths=paths,
        )
        dt = time.time() - t0
    buf = io.BytesIO()
    out.image.save(buf, format="PNG")
    _release()
    return buf.getvalue(), dt


class UnusableCutout(ValueError):
    """The garment's cutout cannot be restored (answered 422: the client makes a normal attempt instead)."""


class Handler(BaseHTTPRequestHandler):
    def _send(
        self, status: int, body: bytes, ctype: str, extra: dict | None = None
    ) -> None:
        self.send_response(status)
        self.send_header("content-type", ctype)
        self.send_header("content-length", str(len(body)))
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        if self.path == "/health":
            import mlx.core as mx

            body = {
                "ok": True,
                "active_gb": round(mx.get_active_memory() / 2**30, 2),
                "cache_gb": round(mx.get_cache_memory() / 2**30, 2),
                "model": MODEL_NAME,
                "loaded": _model is not None,
                "vlm": VLM_ID,
                "vlm_loaded": _vlm is not None,
            }
            self._send(200, json.dumps(body).encode(), "application/json")
        else:
            self._send(404, b"{}", "application/json")

    def do_POST(self) -> None:
        if self.path not in (
            "/v1/edit",
            "/v1/tryon",
            "/v1/describe",
            "/v1/garments",
            "/v1/identify",
            "/v1/verify",
            "/v1/restore",
            "/v1/tryon/check",
        ):
            self._send(404, b"{}", "application/json")
            return
        try:
            n = int(self.headers.get("content-length", "0"))
            if n > 40_000_000:
                raise ValueError("body too large")
            body = json.loads(self.rfile.read(n))
            if self.path == "/v1/describe":
                self._send(200, json.dumps(describe(body)).encode(), "application/json")
                return
            if self.path == "/v1/identify":
                self._send(200, json.dumps(identify(body)).encode(), "application/json")
                return
            if self.path == "/v1/garments":
                self._send(200, json.dumps(garments(body)).encode(), "application/json")
                return
            if self.path == "/v1/tryon/check":
                self._send(200, json.dumps(tryon_check(body)).encode(), "application/json")
                return
            if self.path == "/v1/verify":
                self._send(200, json.dumps(verify(body)).encode(), "application/json")
                return
            png, dt = (
                tryon(body)
                if self.path == "/v1/tryon"
                else restore(body)
                if self.path == "/v1/restore"
                else generate(body)
            )
            self._send(
                200,
                png,
                "image/png",
                {"x-generation-seconds": f"{dt:.2f}", "x-model": MODEL_NAME},
            )
        except UnusableCutout as e:
            self._send(422, json.dumps({"error": str(e)}).encode(), "application/json")
        except (KeyError, ValueError, json.JSONDecodeError) as e:
            self._send(400, json.dumps({"error": str(e)}).encode(), "application/json")
        except Exception as e:  # noqa: BLE001 — report, keep serving
            print(f"[mlx] error: {e!r}", file=sys.stderr, flush=True)
            self._send(
                500,
                json.dumps({"error": type(e).__name__}).encode(),
                "application/json",
            )

    def log_message(self, fmt: str, *args) -> None:  # quieter than the default
        print(f"[mlx] {self.address_string()} {fmt % args}", flush=True)


def main() -> None:
    port = int(os.environ.get("MLX_PORT", "8189"))
    if os.environ.get("MLX_PRELOAD", "1") == "1":
        _worker.submit(model).result()
        if os.environ.get("MLX_VLM", "") != "none":
            _worker.submit(vlm).result()
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"[mlx] listening on http://127.0.0.1:{port}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
