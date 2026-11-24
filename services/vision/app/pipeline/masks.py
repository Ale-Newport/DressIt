"""Binary-mask utilities and cutout construction."""

from __future__ import annotations

import numpy as np
from PIL import Image
from scipy import ndimage

from ..imaging import pad_to_square, composite_on_white


def clean_mask(
    prob: np.ndarray,
    threshold: float = 0.5,
    *,
    keep_ratio: float = 0.25,
    max_hole_frac: float = 0.01,
) -> np.ndarray:
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


def thin_border_structures(mask: np.ndarray, radius: int) -> np.ndarray:
    """Thin parts of ``mask`` (narrower than ~2·``radius``+1 px) that run into the image border.

    A clothesline or a rail crosses the whole frame; the garment's own thin parts (straps,
    chains, laces, a belt) end inside the photo and are kept. Only the thin pieces that
    touch the border are returned — a strap cut by the frame is the accepted risk.
    """
    out = np.zeros(mask.shape, bool)
    if radius < 1 or not mask.any():
        return out
    cross = ndimage.generate_binary_structure(2, 1)
    # border_value=1: an object cut by the frame is not "thin" at the frame.
    eroded = ndimage.binary_erosion(mask, cross, iterations=radius, border_value=1)
    opened = ndimage.binary_dilation(eroded, cross, iterations=radius)
    thin = mask & ~opened
    if not thin.any():
        return out
    labels, n = ndimage.label(thin, structure=np.ones((3, 3), bool))
    frame = np.concatenate(
        [
            labels[:2].ravel(),
            labels[-2:].ravel(),
            labels[:, :2].ravel(),
            labels[:, -2:].ravel(),
        ]
    )
    hit = np.unique(frame[frame > 0])
    return np.isin(labels, hit) if hit.size else out


def carve_thin_near(
    mask: np.ndarray, negatives: list[tuple[float, float]], radius: int, reach: int
) -> np.ndarray:
    """Removes the thin parts of ``mask`` (narrower than ~2·``radius``+1 px: hair strands, fingers,
    a hanger hook) that come within ``reach`` px of a "not garment" point. SAM often keeps hair
    lying over a shoulder despite a negative point; the garment's thick body is never touched.
    """
    if not negatives or radius < 1 or not mask.any():
        return mask
    cross = ndimage.generate_binary_structure(2, 1)
    opened = ndimage.binary_dilation(
        ndimage.binary_erosion(mask, cross, iterations=radius, border_value=1),
        cross,
        iterations=radius,
    )
    thin = mask & ~opened
    if not thin.any():
        return mask
    labels, _ = ndimage.label(thin, structure=np.ones((3, 3), bool))
    h, w = mask.shape
    yy, xx = np.ogrid[:h, :w]
    near = np.zeros(mask.shape, bool)
    for x, y in negatives:
        near |= (xx - x) ** 2 + (yy - y) ** 2 <= reach**2
    hit = np.unique(labels[near & thin])
    hit = hit[hit > 0]
    return mask & ~np.isin(labels, hit) if hit.size else mask


def mask_bbox(mask: np.ndarray) -> tuple[int, int, int, int] | None:
    ys = np.where(mask.any(axis=1))[0]
    xs = np.where(mask.any(axis=0))[0]
    if ys.size == 0 or xs.size == 0:
        return None
    return int(xs[0]), int(ys[0]), int(xs[-1]) + 1, int(ys[-1]) + 1


def touches_border(mask: np.ndarray, min_frac: float = 0.08) -> bool:
    """True if the object runs along an image edge (likely cut off by the frame)."""
    h, w = mask.shape
    edges = [
        mask[0, :].sum() / w,
        mask[-1, :].sum() / w,
        mask[:, 0].sum() / h,
        mask[:, -1].sum() / h,
    ]
    return max(edges) >= min_frac


def mask_iou(a: np.ndarray, b: np.ndarray) -> float:
    inter = np.logical_and(a, b).sum()
    union = np.logical_or(a, b).sum()
    return float(inter / union) if union else 0.0


def padded_box(
    box: tuple[int, int, int, int], padding: float
) -> tuple[int, int, int, int]:
    """Expand a pixel box by ``padding`` × its longest side on every side (may exceed the image)."""
    x0, y0, x1, y1 = box
    pad = int(round(padding * max(x1 - x0, y1 - y0)))
    return x0 - pad, y0 - pad, x1 + pad, y1 + pad


def crop_with_fill(
    arr: np.ndarray, box: tuple[int, int, int, int], fill: float | int = 0
) -> np.ndarray:
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
    rgb: np.ndarray,
    alpha_prob: np.ndarray,
    hard_mask: np.ndarray,
    bbox: tuple[int, int, int, int],
    *,
    padding: float,
    max_side: int,
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
        rgba = rgba.resize(
            (max(1, round(w * scale)), max(1, round(h * scale))),
            Image.Resampling.LANCZOS,
        )
    return rgba


def decontaminate_cutout(rgba: Image.Image) -> Image.Image:
    """The returned cutout with its semi-transparent edge pixels recoloured (no background halo)."""
    arr = np.asarray(rgba.convert("RGBA"))
    rgb = decontaminate_edges(arr[:, :, :3], arr[:, :, 3])
    return Image.fromarray(np.dstack([rgb, arr[:, :, 3]]), mode="RGBA")


def decontaminate_edges(
    rgb: np.ndarray, alpha: np.ndarray, *, opaque: int = 250, work_side: int = 512
) -> np.ndarray:
    """Foreground colour at semi-transparent pixels (multilevel estimation, Germer et al. 2020,
    ``pymatting.estimate_foreground_ml``, MIT).

    The observed colour of an edge pixel mixes garment and old background, which shows as a
    light or dark halo once the cutout is composited on another background. The estimate is
    computed at ≤ ``work_side`` px (it is smooth; ~4× cheaper) and only edge pixels
    (0 < alpha < ``opaque``) take it: opaque and transparent pixels keep their colour.
    """
    edge = (alpha > 0) & (alpha < opaque)
    if not edge.any():
        return rgb
    from pymatting import (
        estimate_foreground_ml,
    )  # rembg dependency; imported lazily (numba)

    h, w = alpha.shape
    scale = min(1.0, work_side / max(h, w))
    if scale < 1.0:
        size = (max(1, round(w * scale)), max(1, round(h * scale)))
        img = (
            np.asarray(
                Image.fromarray(rgb).resize(size, Image.Resampling.BILINEAR),
                dtype=np.float64,
            )
            / 255.0
        )
        a = (
            np.asarray(
                Image.fromarray(alpha).resize(size, Image.Resampling.BILINEAR),
                dtype=np.float64,
            )
            / 255.0
        )
    else:
        img, a = rgb.astype(np.float64) / 255.0, alpha.astype(np.float64) / 255.0
    fg = estimate_foreground_ml(img, a, n_big_iterations=1)
    fg8 = np.clip(np.round(fg * 255.0), 0, 255).astype(np.uint8)
    if scale < 1.0:
        fg8 = np.asarray(Image.fromarray(fg8).resize((w, h), Image.Resampling.BILINEAR))
    out = rgb.copy()
    out[edge] = fg8[edge]
    return out


def region_view(rgb: np.ndarray, mask: np.ndarray, side: int = 256) -> Image.Image:
    """A masked region on white, padded to a square (cheap embedding input for verification)."""
    x0, y0, x1, y1 = mask_bbox(mask) or (0, 0, mask.shape[1], mask.shape[0])
    pad = int(round(0.04 * max(x1 - x0, y1 - y0)))
    box = (x0 - pad, y0 - pad, x1 + pad, y1 + pad)
    crop = crop_with_fill(rgb, box, 255).copy()
    crop[~crop_with_fill(mask, box, False)] = 255
    img = pad_to_square(Image.fromarray(crop))
    return (
        img.resize((side, side), Image.Resampling.BILINEAR)
        if img.size[0] > side
        else img
    )


def support_removal(
    fg: np.ndarray,
    parts: list[np.ndarray],
    p_support: np.ndarray,
    *,
    min_prob: float,
    max_area: float,
    garment_max_prob: float = 0.3,
    core_overlap: float = 0.5,
) -> np.ndarray:
    """Pixels of ``fg`` to remove because they belong to a display support.

    ``parts`` are candidate regions (boolean masks inside ``fg``) and ``p_support`` the
    probability that each one is a support (hanger, mannequin, clothesline, peg…). A
    region is removed when ``p_support >= min_prob`` and it is at most ``max_area`` of the
    foreground — except where it overlaps the *garment core*: the union of the regions
    recognised as garment (``p_support < garment_max_prob``) that are not mostly the support
    itself (overlap < ``core_overlap`` of the support region; a box around "hat + mannequin
    head" protects neither). If the result would remove more than ``max_area`` of the
    foreground, nothing is removed.
    """
    remove = np.zeros(fg.shape, bool)
    total = int(fg.sum())
    if total == 0 or not parts:
        return remove
    sizes = [int(p.sum()) for p in parts]
    garments = [
        p for p, s, q in zip(parts, sizes, p_support) if q < garment_max_prob and s > 0
    ]
    for part, size, prob in zip(parts, sizes, p_support):
        if prob < min_prob or size == 0 or size > max_area * total:
            continue
        core = np.zeros(fg.shape, bool)
        for g in garments:
            if np.logical_and(g, part).sum() < core_overlap * size:
                core |= g
        remove |= part & ~core
    remove &= fg
    if remove.sum() > max_area * total:
        return np.zeros(fg.shape, bool)
    return remove


def embedding_view(cutout: Image.Image) -> Image.Image:
    """What the embedding model sees: cutout on white, padded to a square (model squashes to 224²)."""
    return pad_to_square(composite_on_white(cutout))


def upright_angle(
    mask: np.ndarray, max_angle: float = 25.0
) -> tuple[float, float, float]:
    """Rotation (degrees, counter-clockwise) that makes a garment's silhouette most left–right
    symmetric — clothes are symmetric, so a photo taken at a slant shows a tilted symmetry axis.
    Returns ``(angle, symmetry_at_angle, symmetry_at_zero)`` (mirror IoU, 0–1).
    """
    import cv2

    ys, xs = np.nonzero(mask)
    if ys.size < 50:
        return 0.0, 0.0, 0.0
    # Work on a small square crop centred on the centroid.
    cy, cx = ys.mean(), xs.mean()
    r = int(np.ceil(np.hypot(ys - cy, xs - cx).max())) + 2
    m = np.zeros((2 * r, 2 * r), np.uint8)
    yy, xx = (ys - cy + r).astype(int), (xs - cx + r).astype(int)
    m[np.clip(yy, 0, 2 * r - 1), np.clip(xx, 0, 2 * r - 1)] = 1
    scale = 128 / (2 * r)
    m = cv2.resize(m, (128, 128), interpolation=cv2.INTER_NEAREST)

    def sym(angle: float) -> float:
        rot = cv2.warpAffine(
            m,
            cv2.getRotationMatrix2D((64, 64), angle, 1.0),
            (128, 128),
            flags=cv2.INTER_NEAREST,
        )
        flip = rot[:, ::-1]
        inter = np.logical_and(rot, flip).sum()
        union = np.logical_or(rot, flip).sum()
        return float(inter / union) if union else 0.0

    _ = scale
    coarse = max(np.arange(-max_angle, max_angle + 0.1, 2.5), key=sym)
    fine = max(np.arange(coarse - 2.5, coarse + 2.6, 0.5), key=sym)
    return float(fine), sym(float(fine)), sym(0.0)


def rotate_cutout(cutout: Image.Image, angle: float) -> Image.Image:
    """Rotates an RGBA cutout around its centre, expanding the canvas (transparent corners)."""
    return cutout.rotate(
        angle, resample=Image.Resampling.BICUBIC, expand=True, fillcolor=(0, 0, 0, 0)
    )
