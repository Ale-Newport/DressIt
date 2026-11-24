"""Manual cutout correction: the user taps "garment" / "not garment" points on the photo and the
promptable segmenter (SAM 2.1) re-segments the garment from those points (and the previous box,
when given). The result goes through the same cleanup as automatic cutouts.
"""

from __future__ import annotations

from typing import Any, Sequence

import numpy as np

from ..colors import extract_colors
from ..config import Settings
from ..imaging import (
    decode_image,
    encode_png_base64,
    normalize_cutout_colors,
    resize_max_side,
)
from ..models.base import VisionBackend
from .masks import (
    carve_thin_near,
    clean_mask,
    decontaminate_cutout,
    make_cutout,
    mask_bbox,
)

MAX_POINTS = 20


def segment_with_points(
    data: bytes,
    points: Sequence[tuple[float, float, int]],
    box: tuple[float, float, float, float] | None,
    *,
    backend: VisionBackend,
    settings: Settings,
) -> dict[str, Any]:
    """``points``/``box`` are normalised (0–1) to the photo; returns the new cutout and its bbox."""
    if not points or not any(lbl == 1 for _, _, lbl in points):
        raise ValueError("Marca al menos un punto sobre la prenda.")
    decoded = decode_image(data)
    work, _ = resize_max_side(decoded.rgb, settings.working_max_side)
    w, h = work.size
    px = [(x * w, y * h, int(lbl)) for x, y, lbl in list(points)[:MAX_POINTS]]
    pbox = (box[0] * w, box[1] * h, box[2] * w, box[3] * h) if box else None
    prob = backend.segment_points(work, px, pbox)
    # Keep the component(s) under the positive points; drop specks.
    mask = clean_mask(prob, keep_ratio=0.15)
    for x, y, lbl in px:
        if lbl == 0:
            continue
        if (
            not mask[min(h - 1, int(y)), min(w - 1, int(x))]
            and prob[min(h - 1, int(y)), min(w - 1, int(x))] > 0.3
        ):
            mask[min(h - 1, int(y)), min(w - 1, int(x))] = True
    # "Not garment" points also remove thin strands near them (hair over a shoulder, fingers).
    side = max(w, h)
    negatives = [(x, y) for x, y, lbl in px if lbl == 0]
    mask = carve_thin_near(
        mask,
        negatives,
        radius=max(2, round(side * 0.012)),
        reach=max(8, round(side * 0.08)),
    )
    mask = clean_mask(mask.astype(np.float32), keep_ratio=0.15)
    bbox = mask_bbox(mask)
    if bbox is None:
        raise ValueError(
            "No se ha podido separar la prenda con esos puntos. Prueba a marcar más zonas."
        )
    rgb = np.asarray(work)
    if settings.normalize_cutout:
        rgb, _ = normalize_cutout_colors(rgb, mask)
    cutout = make_cutout(
        rgb,
        prob,
        mask,
        bbox,
        padding=settings.cutout_padding,
        max_side=settings.cutout_max_side,
    )
    if settings.decontaminate_edges:
        cutout = decontaminate_cutout(cutout)
    x0, y0, x1, y1 = bbox
    colors = [
        c.to_dict() for c in extract_colors(rgb[y0:y1, x0:x1][mask[y0:y1, x0:x1]])
    ]
    return {
        "cutout_png_base64": encode_png_base64(cutout),
        "bbox": [
            round(x0 / w, 4),
            round(y0 / h, 4),
            round(x1 / w, 4),
            round(y1 / h, 4),
        ],
        "mask_area_ratio": round(float(mask.mean()), 4),
        "colors": colors,
    }
