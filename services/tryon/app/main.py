"""DressIt try-on service.

- ``POST /v1/tryon``: one garment onto a person photo (FASHN VTON v1.5, maskless, flat-lay garment).
  Multi-garment outfits are dressed sequentially by the API (bottoms → tops → outerwear), each pass
  starting from the previous result; the API caches every intermediate image.
- ``POST /v1/parse``: where the upper/lower clothing, shoes and face are (Sapiens2-seg-0.4b), as
  RGBA crops — used by the API's fidelity gate.
- ``GET /health``.

Models load lazily on first use and are kept in memory. One generation at a time per process (the
GPU/Apple Silicon is the bottleneck); the API's queue already serialises jobs.
"""

from __future__ import annotations

import base64
import io
import logging
import os
import threading
import time

from fastapi import FastAPI, File, Form, UploadFile
from fastapi.responses import JSONResponse, Response
import numpy as np
from PIL import Image, UnidentifiedImageError

from .parsing import EXTRA_REGIONS, REGIONS, agnostic_mask, crop_region, extras_region, parse, paste_region, region_mask
from .runner import FashnRunner, pick_device

log = logging.getLogger("tryon")
logging.basicConfig(level=logging.INFO)
MODELS = os.environ.get("TRYON_MODELS_DIR", os.path.join(os.path.dirname(__file__), "..", "models"))
DEVICE = os.environ.get("TRYON_DEVICE") or str(pick_device())
MAX_BYTES = 20 * 1024 * 1024

app = FastAPI(title="DressIt try-on", version="0.1.0")
_lock = threading.Lock()
_runner: FashnRunner | None = None


def runner() -> FashnRunner:
    global _runner
    if _runner is None:
        _runner = FashnRunner(os.path.join(MODELS, "fashn-vton-1.5"), os.path.join(MODELS, "dwpose"), device=DEVICE)
    return _runner


def _error(status: int, code: str, message: str) -> JSONResponse:
    return JSONResponse({"error": {"code": code, "message": message}}, status_code=status)


async def _image(upload: UploadFile) -> Image.Image:
    data = await upload.read()
    if len(data) > MAX_BYTES:
        raise ValueError("La imagen es demasiado grande.")
    try:
        img = Image.open(io.BytesIO(data))
        img.load()
    except (UnidentifiedImageError, OSError) as exc:
        raise ValueError("No se ha podido leer la imagen.") from exc
    return img


def _flat_lay(img: Image.Image) -> Image.Image:
    """Garment cutouts arrive with transparency: put them on white, as FASHN expects for flat-lays."""
    if img.mode in ("RGBA", "LA", "P"):
        rgba = img.convert("RGBA")
        bg = Image.new("RGBA", rgba.size, (255, 255, 255, 255))
        bg.alpha_composite(rgba)
        return bg.convert("RGB")
    return img.convert("RGB")


@app.get("/health")
def health() -> dict:
    return {
        "status": "ok",
        "device": DEVICE,
        "models": {
            "fashn-vton-1.5": os.path.exists(os.path.join(MODELS, "fashn-vton-1.5", "model.safetensors")),
            "dwpose": os.path.exists(os.path.join(MODELS, "dwpose", "dw-ll_ucoco_384.onnx")),
            "sapiens2-seg-0.4b": os.path.exists(os.path.join(MODELS, "sapiens2-seg-0.4b", "model.safetensors")),
        },
        "loaded": _runner is not None,
    }


@app.post("/v1/tryon")
async def tryon(
    person: UploadFile = File(...),
    garment: UploadFile = File(...),
    category: str = Form(...),
    steps: int = Form(20),
    seed: int = Form(42),
    mask: bool = Form(False),
) -> Response:
    """``mask=true`` replaces what the person wears in that region (Sapiens2 clothing-agnostic image);
    ``mask=false`` dresses over it (for a jacket or cardigan on top of an earlier layer)."""
    if category not in ("tops", "bottoms", "one-pieces"):
        return _error(422, "invalid_category", "category debe ser tops, bottoms o one-pieces.")
    if not 4 <= steps <= 50:
        return _error(422, "invalid_steps", "steps debe estar entre 4 y 50.")
    try:
        p, g = await _image(person), _flat_lay(await _image(garment))
    except ValueError as exc:
        return _error(422, "invalid_image", str(exc))
    t = time.perf_counter()
    with _lock:
        mask_fn = (lambda img, cat: agnostic_mask(parse(img, os.path.join(MODELS, "sapiens2-seg-0.4b"), DEVICE), cat)) if mask else None  # noqa: E731
        out = runner()(p, g, category, steps=steps, seed=seed, mask_fn=mask_fn)  # type: ignore[arg-type]
    buf = io.BytesIO()
    out.image.save(buf, "PNG")
    headers = {"x-timings-ms": f"{round((time.perf_counter() - t) * 1000)}", "x-model": "fashn-vton-1.5", "x-masked": "1" if mask else "0"}
    return Response(buf.getvalue(), media_type="image/png", headers=headers)


@app.post("/v1/composite")
async def composite(
    base: UploadFile = File(...),
    edited: UploadFile = File(...),
    regions: str = Form(...),
) -> Response:
    """Keeps an extras pass (shoes, hat, scarf) only inside those body regions (comma-separated:
    ``feet``, ``head``, ``neck``); the rest of the image is ``base`` pixel for pixel."""
    wanted = [r.strip() for r in regions.split(",") if r.strip()]
    if not wanted or any(r not in EXTRA_REGIONS for r in wanted):
        return _error(422, "invalid_regions", "regions debe ser una lista de: feet, head, neck.")
    try:
        b = (await _image(base)).convert("RGB")
        e = (await _image(edited)).convert("RGB").resize((b.width, b.height), Image.Resampling.LANCZOS)
    except ValueError as exc:
        return _error(422, "invalid_image", str(exc))
    with _lock:
        path = os.path.join(MODELS, "sapiens2-seg-0.4b")
        lb, le = parse(b, path, DEVICE), parse(e, path, DEVICE)
    mask = np.zeros((b.height, b.width), bool)
    for r in wanted:
        mask |= extras_region(lb, le, r)
    out = paste_region(b, e, mask)
    buf = io.BytesIO()
    out.save(buf, "PNG")
    return Response(buf.getvalue(), media_type="image/png", headers={"x-region-area": f"{mask.mean():.4f}"})


@app.post("/v1/parse")
async def parse_regions(image: UploadFile = File(...)) -> JSONResponse:
    try:
        img = (await _image(image)).convert("RGB")
    except ValueError as exc:
        return _error(422, "invalid_image", str(exc))
    with _lock:
        labels = parse(img, os.path.join(MODELS, "sapiens2-seg-0.4b"), DEVICE)
    out: dict = {}
    for region in REGIONS:
        mask = region_mask(labels, region)
        crop = crop_region(img, mask)
        buf = io.BytesIO()
        if crop is not None:
            crop.save(buf, "PNG")
        out[region] = {"area": round(float(mask.mean()), 4), "png_base64": base64.b64encode(buf.getvalue()).decode() if crop is not None else None}
    return JSONResponse(out)
