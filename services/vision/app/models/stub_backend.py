"""STUB backend — deterministic, dependency-free, NO real models. Tests/CI only.

* Image "embeddings" are a fixed random projection of an 8×8 colour thumbnail
  (similar images → similar vectors), text "embeddings" are hash-seeded random
  vectors. They are nearly orthogonal, so every zero-shot head is ~uniform and
  the pipeline abstains (``null``) — the stub never invents attributes.
* Background removal is a border-colour difference threshold; detection is
  connected components of that mask; OCR returns nothing.
/health reports ``backend: "stub"`` and every response carries
``model_versions.backend = "stub"`` so nobody mistakes it for the real thing.
"""

from __future__ import annotations

import hashlib
from typing import Sequence

import numpy as np
from PIL import Image
from scipy import ndimage

from ..colors import rgb_to_lab
from .base import Detection, OcrLine

STUB_DIM = 768
STUB_MODEL_ID = "stub/deterministic-projection-768"


class StubBackend:
    name = "stub"
    device = "cpu"
    embedding_model_id = STUB_MODEL_ID
    embedding_dim = STUB_DIM

    def __init__(self) -> None:
        rng = np.random.default_rng(1234)
        self._projection = rng.standard_normal((8 * 8 * 3 + 3, STUB_DIM)).astype(np.float32)

    # -- embeddings -------------------------------------------------------
    def embed_images(self, images: Sequence[Image.Image]) -> np.ndarray:
        feats = []
        for img in images:
            small = np.asarray(img.convert("RGB").resize((8, 8), Image.Resampling.BILINEAR), dtype=np.float32) / 255.0
            vec = np.concatenate([small.reshape(-1) - 0.5, small.reshape(-1, 3).std(axis=0)])
            feats.append(vec @ self._projection)
        out = np.stack(feats) if feats else np.zeros((0, STUB_DIM), np.float32)
        return _l2(out)

    def embed_texts(self, texts: Sequence[str]) -> np.ndarray:
        rows = []
        for text in texts:
            seed = int.from_bytes(hashlib.sha256(text.encode("utf-8")).digest()[:8], "big")
            rows.append(np.random.default_rng(seed).standard_normal(STUB_DIM).astype(np.float32))
        out = np.stack(rows) if rows else np.zeros((0, STUB_DIM), np.float32)
        return _l2(out)

    # -- segmentation / detection ----------------------------------------
    def remove_background(self, image: Image.Image) -> np.ndarray:
        rgb = np.asarray(image.convert("RGB"))
        h, w = rgb.shape[:2]
        step = max(1, int(max(h, w) // 512))
        lab = rgb_to_lab(rgb[::step, ::step].astype(np.float64))
        b = max(1, min(lab.shape[:2]) // 50)
        frame = np.concatenate([lab[:b].reshape(-1, 3), lab[-b:].reshape(-1, 3), lab[:, :b].reshape(-1, 3), lab[:, -b:].reshape(-1, 3)])
        diff = np.linalg.norm(lab - np.median(frame, axis=0), axis=2) > 12.0
        diff = ndimage.binary_opening(diff, iterations=1)
        diff = ndimage.binary_fill_holes(diff)
        mask = np.asarray(Image.fromarray((diff * 255).astype(np.uint8)).resize((w, h), Image.Resampling.NEAREST))
        return mask.astype(np.float32) / 255.0

    def detect(
        self, image: Image.Image, queries: Sequence[str], threshold: float, *, short_side: int | None = None
    ) -> list[Detection]:
        mask = self.remove_background(image) > 0.5
        labels, n = ndimage.label(mask)
        out: list[Detection] = []
        for sl in ndimage.find_objects(labels):
            if sl is None:
                continue
            ys, xs = sl
            out.append(Detection(box=(float(xs.start), float(ys.start), float(xs.stop), float(ys.stop)), score=0.5, label="object"))
        return out

    def segment_boxes(self, image: Image.Image, boxes: Sequence[tuple[float, float, float, float]]) -> list[np.ndarray]:
        fg = self.remove_background(image)
        masks = []
        for x0, y0, x1, y1 in boxes:
            m = np.zeros_like(fg)
            ys, xs = slice(int(y0), int(np.ceil(y1))), slice(int(x0), int(np.ceil(x1)))
            m[ys, xs] = fg[ys, xs]
            masks.append(m)
        return masks

    def ocr(self, image: Image.Image) -> list[OcrLine]:
        return []

    # -- metadata ---------------------------------------------------------
    def models_status(self) -> dict[str, bool]:
        return {"stub": True}

    def model_versions(self) -> dict[str, str]:
        return {
            "backend": "stub",
            "embedding": STUB_MODEL_ID,
            "note": "STUB backend: deterministic placeholders, not real models (tests/CI only)",
        }


def _l2(x: np.ndarray) -> np.ndarray:
    norms = np.linalg.norm(x, axis=1, keepdims=True)
    return (x / np.maximum(norms, 1e-12)).astype(np.float32)
