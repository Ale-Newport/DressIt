"""Single-mode cutout refinement: remove display supports from the salient-object mask.

Background removal (rembg) keeps everything salient: the garment *and* the hanger hook,
the mannequin head under a beanie, the clothesline and its pegs. Here:

1. Grounding DINO proposes regions with the garment queries plus a closed list of
   support queries (hanger, mannequin, clothesline, clothespin, hook — never "person"),
   at a reduced input size; it runs in parallel with rembg.
2. SAM 2.1 segments every proposal box; each region is intersected with the foreground.
3. FashionSigLIP verifies every region: garments, garment parts (straps, chains, laces…)
   and the reject classes compete with the support classes in one softmax. Detector
   labels are never trusted (Grounding DINO tiny finds a "mannequin" in any garment).
4. Regions confidently taken for a support are removed, except where a region recognised
   as garment overlaps them (:func:`masks.support_removal`).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np
from PIL import Image
from scipy import ndimage

from ..config import Settings
from ..models.base import Detection, VisionBackend
from ..prompts import DETECTION_QUERIES, PROP_QUERIES
from .classify import get_heads, support_probability
from .detect import area, iou
from .masks import mask_iou, region_view, support_removal, thin_border_structures

PROPOSAL_THRESHOLD = 0.2
MIN_PART_FRAC = 0.002  # of the foreground
PROPOSAL_QUERIES: tuple[str, ...] = DETECTION_QUERIES + PROP_QUERIES


@dataclass(eq=False)
class Proposal:
    det: Detection
    mask: (
        np.ndarray
    )  # SAM mask (bool) limited to the slightly expanded box, region coords


def rank_proposals(
    dets: list[Detection], width: int, height: int, max_n: int
) -> list[Detection]:
    """Boxes worth segmenting: by score, without near-duplicates or near-full-frame boxes."""
    frame = (0.0, 0.0, float(width), float(height))
    out: list[Detection] = []
    for d in sorted(dets, key=lambda d: -d.score):
        if area(d.box) >= 0.9 * area(frame):
            continue  # the whole photo says nothing about the parts of the object
        if any(iou(d.box, k.box) >= 0.8 for k in out):
            continue
        out.append(d)
        if len(out) >= max_n:
            break
    return out


def propose_regions(
    backend: VisionBackend, settings: Settings, region: Image.Image
) -> list[Proposal]:
    """Detector boxes for garments and supports, segmented by SAM. Runs in parallel with
    background removal (it does not need the foreground). The region is padded (bottom/right)
    to a square so the detector always sees the same input shape (no per-shape recompilation
    on MPS) and box coordinates stay those of ``region``."""
    w, h = region.size
    side = max(w, h)
    square = Image.new("RGB", (side, side), (255, 255, 255))
    square.paste(region.convert("RGB"), (0, 0))
    dets: list[Detection] = []
    for d in backend.detect(
        square,
        PROPOSAL_QUERIES,
        PROPOSAL_THRESHOLD,
        short_side=settings.proposal_short_side,
    ):
        x0, y0, x1, y1 = d.box[0], d.box[1], min(d.box[2], w), min(d.box[3], h)
        if x1 - x0 >= 2 and y1 - y0 >= 2:
            dets.append(Detection(box=(x0, y0, x1, y1), score=d.score, label=d.label))
    dets = rank_proposals(dets, w, h, settings.max_proposals)
    if not dets:
        return []
    out: list[Proposal] = []
    for d, m in zip(dets, backend.segment_boxes(region, [d.box for d in dets])):
        x0, y0, x1, y1 = (int(round(v)) for v in d.box)
        pad = int(0.02 * max(x1 - x0, y1 - y0))
        gate = np.zeros((h, w), bool)
        gate[max(0, y0 - pad) : y1 + pad, max(0, x0 - pad) : x1 + pad] = True
        out.append(Proposal(det=d, mask=(m >= 0.5) & gate))
    return out


def promote_head_forms(
    fg: np.ndarray,
    parts: list[np.ndarray],
    p_support: np.ndarray,
    is_form: np.ndarray,
    *,
    min_prob: float,
    to: float,
) -> np.ndarray:
    """Hat on a head form: a region whose most likely class is a mannequin/head form, with
    P(support) ≥ ``min_prob``, that reaches the bottom of the object and starts clearly
    below its top (the hat sits on it) gets P(support) raised to ``to``."""
    out = p_support.copy()
    ys = np.nonzero(fg.any(axis=1))[0]
    if ys.size == 0:
        return out
    top, bottom = int(ys[0]), int(ys[-1])
    height = max(1, bottom - top)
    for i, part in enumerate(parts):
        if not is_form[i] or p_support[i] < min_prob:
            continue
        rows = np.nonzero(part.any(axis=1))[0]
        if (
            rows.size
            and rows[-1] >= bottom - 0.03 * height
            and rows[0] >= top + 0.15 * height
        ):
            out[i] = max(out[i], to)
    return out


def remove_border_lines(settings: Settings, prob: np.ndarray) -> np.ndarray:
    """Zero the thin structures that cross into the frame border (clothesline, rail)."""
    if settings.thin_border_radius <= 0:
        return prob
    radius = max(1, int(round(settings.thin_border_radius * max(prob.shape))))
    lines = thin_border_structures(prob >= 0.5, radius)
    if not lines.any():
        return prob
    thick = ndimage.binary_erosion(prob >= 0.5, iterations=radius + 1, border_value=1)
    lines = ndimage.binary_dilation(lines, iterations=1) & ~thick
    return np.where(lines, 0.0, prob).astype(np.float32)


def remove_supports(
    backend: VisionBackend,
    settings: Settings,
    region: Image.Image,
    prob: np.ndarray,
    proposals: list[Proposal],
    *,
    headwear: bool = False,
) -> tuple[np.ndarray, dict[str, Any]]:
    """Returns the foreground probability with support pixels zeroed, and a small report.

    ``headwear``: the whole photo looks like a hat/cap/beanie, so a region at the bottom of
    the object that the model takes for a mannequin/head form needs less evidence
    (``support_min_prob_head_form``): a plain head form under a cap looks like a hat to it.
    """
    info: dict[str, Any] = {
        "proposals": len(proposals),
        "regions": 0,
        "removed_frac": 0.0,
    }
    fg = prob >= 0.5
    total = int(fg.sum())
    if not proposals or total == 0:
        return prob, info
    parts: list[np.ndarray] = []
    for pr in proposals:
        part = pr.mask & fg
        if part.sum() < max(64, MIN_PART_FRAC * total):
            continue
        if any(mask_iou(part, k) >= 0.85 for k in parts):
            continue
        parts.append(part)
    info["regions"] = len(parts)
    if not parts:
        return prob, info
    rgb = np.asarray(region.convert("RGB"))
    # Regions too big to be removed are not embedded: they only count as garment core.
    small = [
        i for i, p in enumerate(parts) if p.sum() <= settings.support_max_area * total
    ]
    p_support = np.zeros(len(parts), np.float32)
    if small:
        emb = backend.embed_images([region_view(rgb, parts[i]) for i in small])
        p_small, form_small = support_probability(get_heads(backend, settings), emb)
        p_support[small] = p_small
        if headwear:
            is_form = np.zeros(len(parts), bool)
            is_form[small] = form_small
            p_support = promote_head_forms(
                fg,
                parts,
                p_support,
                is_form,
                min_prob=settings.support_min_prob_head_form,
                to=settings.support_min_prob,
            )
    remove = support_removal(
        fg,
        parts,
        p_support,
        min_prob=settings.support_min_prob,
        max_area=settings.support_max_area,
    )
    info["p_support"] = [round(float(p), 3) for p in p_support]
    if not remove.any():
        return prob, info
    # One more pixel around the support: its anti-aliased rim is not garment either.
    remove = ndimage.binary_dilation(remove, iterations=1) & ~_core(
        parts, p_support, remove
    )
    info["removed_frac"] = round(float(np.logical_and(remove, fg).sum()) / total, 4)
    return np.where(remove, 0.0, prob).astype(np.float32), info


def _core(
    parts: list[np.ndarray], p_support: np.ndarray, remove: np.ndarray
) -> np.ndarray:
    """Garment regions not touched by the removal (the dilation must not eat into them)."""
    core = np.zeros(remove.shape, bool)
    for p, q in zip(parts, p_support):
        if q < 0.3 and not np.logical_and(p, remove).any():
            core |= p
    return core
