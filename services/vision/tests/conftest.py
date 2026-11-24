"""Tests always run against the deterministic STUB backend (no model downloads)."""

from __future__ import annotations

import io
import os

os.environ["VISION_BACKEND"] = "stub"
os.environ.pop("VISION_LOGIT_SCALE", None)

import numpy as np  # noqa: E402
import pytest  # noqa: E402
from PIL import Image  # noqa: E402


@pytest.fixture(scope="session")
def client():
    from fastapi.testclient import TestClient

    from app.config import get_settings
    from app.main import app
    from app.models import reset_backend

    get_settings.cache_clear()
    reset_backend()
    with TestClient(app) as c:
        yield c


def png_bytes(arr: np.ndarray) -> bytes:
    buf = io.BytesIO()
    Image.fromarray(arr.astype(np.uint8)).save(buf, format="PNG")
    return buf.getvalue()


def jpeg_bytes(img: Image.Image, quality: int = 90, exif: bytes | None = None) -> bytes:
    buf = io.BytesIO()
    kwargs = {"quality": quality}
    if exif is not None:
        kwargs["exif"] = exif
    img.save(buf, format="JPEG", **kwargs)
    return buf.getvalue()


def garment_image(color=(198, 40, 40), size=(480, 640), bg=(245, 245, 245)) -> np.ndarray:
    """A crude T-shirt silhouette on a plain background."""
    w, h = size
    arr = np.zeros((h, w, 3), np.uint8)
    arr[:] = bg
    arr[int(h * 0.25) : int(h * 0.85), int(w * 0.3) : int(w * 0.7)] = color  # body
    arr[int(h * 0.25) : int(h * 0.42), int(w * 0.15) : int(w * 0.85)] = color  # sleeves
    return arr
