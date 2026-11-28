"""Backend protocol: everything model-specific lives behind this interface."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol, Sequence, runtime_checkable

import numpy as np
from PIL import Image


@dataclass(frozen=True)
class Detection:
    """A garment box from the open-vocabulary detector, in pixels of the input image."""

    box: tuple[float, float, float, float]  # x0, y0, x1, y1
    score: float
    label: str  # the text query that matched (internal hint only)


@dataclass(frozen=True)
class OcrLine:
    text: str
    confidence: float
    box: tuple[float, float, float, float]  # normalised 0–1 (x0, y0, x1, y1)


@runtime_checkable
class VisionBackend(Protocol):
    name: str  # "torch" | "stub"
    device: str
    embedding_model_id: str
    embedding_dim: int

    def embed_images(self, images: Sequence[Image.Image]) -> np.ndarray:
        """L2-normalised embeddings ``(N, D)`` float32. Callers pad to square first."""

    def embed_texts(self, texts: Sequence[str]) -> np.ndarray:
        """L2-normalised text embeddings ``(N, D)`` float32 in the same space as images."""

    def remove_background(self, image: Image.Image) -> np.ndarray:
        """Foreground probability ``(H, W)`` float32 in [0, 1] for the salient object(s)."""

    def matte_studio(self, image: Image.Image) -> np.ndarray:
        """Foreground probability ``(H, W)`` for a studio photo (one item on a plain background).
        Backends with a dedicated matting model override it; by default, background removal."""
        return self.remove_background(image)

    def detect(
        self,
        image: Image.Image,
        queries: Sequence[str],
        threshold: float,
        *,
        short_side: int | None = None,
    ) -> list[Detection]:
        """Open-vocabulary detection (boxes in pixels of ``image``). ``short_side`` lowers the
        detector's input resolution (faster; used for single-mode region proposals)."""

    def segment_boxes(
        self, image: Image.Image, boxes: Sequence[tuple[float, float, float, float]]
    ) -> list[np.ndarray]:
        """Box-prompted instance masks, one ``(H, W)`` float32 [0, 1] per box."""

    def segment_points(
        self,
        image: Image.Image,
        points: Sequence[tuple[float, float, int]],
        box: tuple[float, float, float, float] | None = None,
    ) -> np.ndarray:
        """Point-prompted mask (pixels; label 1 = garment, 0 = not garment), ``(H, W)`` float32 [0, 1]."""

    def ocr(self, image: Image.Image) -> list[OcrLine]:
        """Text lines (Spanish/English)."""

    def models_status(self) -> dict[str, bool]:
        """``{model_name: loaded}`` for /health."""

    def model_versions(self) -> dict[str, str]:
        """Exact model ids + revisions, echoed in every analyze response."""
