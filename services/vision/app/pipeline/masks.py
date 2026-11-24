"""Binary-mask utilities and cutout construction."""

from __future__ import annotations

import numpy as np
from PIL import Image
from scipy import ndimage

from ..imaging import pad_to_square, composite_on_white


def clean_mask(prob: np.ndarray, threshold: float = 0.5, *, keep_ratio: float = 0.25, max_hole_frac: float = 0.01) -> np.ndarray:
    """Threshold, drop specks, keep the main component(s), fill only small holes.

    Components smaller than ``keep_ratio`` × the largest one are removed (a pair
    of shoes keeps both, dust/noise goes). Holes are filled only when smaller
    than ``max_hole_frac`` of the object (a bag handle loop stays background).
    """
    mask = prob >= threshold
    if not mask.any():
        return mask
    labels, n = ndimage.label(mask)
    if n > 1:
        sizes = ndimage.sum(mask, labels, index=np.arange(1, n + 1))
        keep = np.where(sizes >= keep_ratio * sizes.max())[0] + 1
        mask = np.isin(labels, keep)
    holes = ndimage.binary_fill_holes(mask) & ~mask
    if holes.any():
        hl, hn = ndimage.label(holes)
        hs = ndimage.sum(holes, hl, index=np.arange(1, hn + 1))
        small = np.where(hs <= max_hole_frac * mask.sum())[0] + 1
        mask = mask | np.isin(hl, small)
    return mask


def mask_bbox(mask: np.ndarray) -> tuple[int, int, int, int] | None:
    ys = np.where(mask.any(axis=1))[0]
    xs = np.where(mask.any(axis=0))[0]
    if ys.size == 0 or xs.size == 0:
        return None
    return int(xs[0]), int(ys[0]), int(xs[-1]) + 1, int(ys[-1]) + 1


def touches_border(mask: np.ndarray, min_frac: float = 0.08) -> bool:
    """True if the object runs along an image edge (likely cut off by the frame)."""
    h, w = mask.shape
    edges = [mask[0, :].sum() / w, mask[-1, :].sum() / w, mask[:, 0].sum() / h, mask[:, -1].sum() / h]
    return max(edges) >= min_frac


def mask_iou(a: np.ndarray, b: np.ndarray) -> float:
    inter = np.logical_and(a, b).sum()
    union = np.logical_or(a, b).sum()
    return float(inter / union) if union else 0.0


def padded_box(box: tuple[int, int, int, int], padding: float) -> tuple[int, int, int, int]:
    """Expand a pixel box by ``padding`` × its longest side on every side (may exceed the image)."""
    x0, y0, x1, y1 = box
    pad = int(round(padding * max(x1 - x0, y1 - y0)))
    return x0 - pad, y0 - pad, x1 + pad, y1 + pad


def crop_with_fill(arr: np.ndarray, box: tuple[int, int, int, int], fill: float | int = 0) -> np.ndarray:
    """Crop ``arr`` (H, W[, C]) to ``box``; regions outside the image are filled."""
    x0, y0, x1, y1 = box
    h, w = arr.shape[:2]
    out_shape = (y1 - y0, x1 - x0) + arr.shape[2:]
    out = np.full(out_shape, fill, dtype=arr.dtype)
    sx0, sy0, sx1, sy1 = max(0, x0), max(0, y0), min(w, x1), min(h, y1)
    if sx1 > sx0 and sy1 > sy0:
        out[sy0 - y0 : sy1 - y0, sx0 - x0 : sx1 - x0] = arr[sy0:sy1, sx0:sx1]
    return out


def make_cutout(
    rgb: np.ndarray, alpha_prob: np.ndarray, hard_mask: np.ndarray, bbox: tuple[int, int, int, int], *, padding: float, max_side: int
) -> Image.Image:
    """RGBA cutout cropped to ``bbox`` + padding; soft alpha restricted to the cleaned mask."""
    box = padded_box(bbox, padding)
    near = ndimage.binary_dilation(hard_mask, iterations=2)
    soft = np.clip(alpha_prob, 0.0, 1.0)
    # Inside the cleaned mask: at least half opaque; in a 2-px rim: soft edge; elsewhere: transparent.
    alpha = np.where(hard_mask, np.maximum(soft, 0.5), np.where(near, soft, 0.0))
    rgb_c = crop_with_fill(rgb, box, 255)
    a_c = crop_with_fill((alpha * 255).round().astype(np.uint8), box, 0)
    rgba = Image.fromarray(np.dstack([rgb_c, a_c]), mode="RGBA")
    w, h = rgba.size
    scale = min(1.0, max_side / max(w, h))
    if scale < 1.0:
        rgba = rgba.resize((max(1, round(w * scale)), max(1, round(h * scale))), Image.Resampling.LANCZOS)
    return rgba


def embedding_view(cutout: Image.Image) -> Image.Image:
    """What the embedding model sees: cutout on white, padded to a square (model squashes to 224²)."""
    return pad_to_square(composite_on_white(cutout))
