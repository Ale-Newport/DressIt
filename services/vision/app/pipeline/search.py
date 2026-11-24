"""Text and whole-image embeddings for search (same 768-d space as item embeddings)."""

from __future__ import annotations

import numpy as np
from PIL import Image

from ..imaging import pad_to_square
from ..models.base import VisionBackend
from ..prompts import translate_query

# Query templates averaged per text (product-title style, as FashionSigLIP was trained).
QUERY_TEMPLATES: tuple[str, ...] = ("{}", "a photo of {}")


def embed_text_queries(backend: VisionBackend, texts: list[str]) -> tuple[np.ndarray, list[str]]:
    translated = [translate_query(t) for t in texts]
    expanded = [tpl.format(t) for t in translated for tpl in QUERY_TEMPLATES]
    emb = backend.embed_texts(expanded).reshape(len(texts), len(QUERY_TEMPLATES), -1).mean(axis=1)
    emb /= np.maximum(np.linalg.norm(emb, axis=1, keepdims=True), 1e-12)
    return emb.astype(np.float32), translated


def embed_whole_image(backend: VisionBackend, image: Image.Image) -> np.ndarray:
    return backend.embed_images([pad_to_square(image.convert("RGB"))])[0]
