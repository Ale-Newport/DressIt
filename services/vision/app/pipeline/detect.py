"""Post-processing of open-vocabulary detections: NMS, tiny/duplicate removal, pair merging."""

from __future__ import annotations

from ..models.base import Detection
from ..prompts import DETECTION_GROUPS, PAIRED_GROUPS

Box = tuple[float, float, float, float]


def group_of(label: str) -> str:
    """Coarse group of a detector label. Grounding DINO may return phrases mixing several
    queries ("a sneaker a high heel shoe"); the earliest recognised noun wins."""
    text = label.strip().lower()
    best: tuple[int, str] | None = None
    for noun, group in DETECTION_GROUPS:
        pos = text.find(noun)
        if pos >= 0 and (best is None or pos < best[0]):
            best = (pos, group)
    return best[1] if best else "unknown"


def area(b: Box) -> float:
    return max(0.0, b[2] - b[0]) * max(0.0, b[3] - b[1])


def iou(a: Box, b: Box) -> float:
    ix = max(0.0, min(a[2], b[2]) - max(a[0], b[0]))
    iy = max(0.0, min(a[3], b[3]) - max(a[1], b[1]))
    inter = ix * iy
    union = area(a) + area(b) - inter
    return inter / union if union > 0 else 0.0


def containment(inner: Box, outer: Box) -> float:
    """Fraction of ``inner`` that lies inside ``outer``."""
    ix = max(0.0, min(inner[2], outer[2]) - max(inner[0], outer[0]))
    iy = max(0.0, min(inner[3], outer[3]) - max(inner[1], outer[1]))
    a = area(inner)
    return ix * iy / a if a > 0 else 0.0


def union_box(a: Box, b: Box) -> Box:
    return min(a[0], b[0]), min(a[1], b[1]), max(a[2], b[2]), max(a[3], b[3])


def merge_pairs(dets: list[Detection]) -> list[Detection]:
    """Two shoes (or gloves) of similar size side by side are one wardrobe item."""
    paired = [d for d in dets if group_of(d.label) in PAIRED_GROUPS]
    others = [d for d in dets if d not in paired]
    paired.sort(key=lambda d: -d.score)
    used: set[int] = set()
    merged: list[Detection] = []
    for i, a in enumerate(paired):
        if i in used:
            continue
        best_j, best_gap = None, None
        for j in range(i + 1, len(paired)):
            if j in used:
                continue
            b = paired[j]
            if group_of(a.label) != group_of(b.label) or iou(a.box, b.box) > 0.3:
                continue  # different kind of item, or the same shoe found twice (NMS handles it)
            ratio = area(a.box) / max(area(b.box), 1e-6)
            if not 0.4 <= ratio <= 2.5:
                continue
            size = max(
                a.box[2] - a.box[0],
                a.box[3] - a.box[1],
                b.box[2] - b.box[0],
                b.box[3] - b.box[1],
            )
            gap_x = max(0.0, max(a.box[0], b.box[0]) - min(a.box[2], b.box[2]))
            gap_y = max(0.0, max(a.box[1], b.box[1]) - min(a.box[3], b.box[3]))
            gap = max(gap_x, gap_y)
            # Side by side (worn or on the floor) or one in front of the other.
            if gap <= 1.2 * size and (best_gap is None or gap < best_gap):
                best_j, best_gap = j, gap
        if best_j is not None:
            used.update({i, best_j})
            b = paired[best_j]
            merged.append(
                Detection(
                    box=union_box(a.box, b.box),
                    score=max(a.score, b.score),
                    label=a.label,
                )
            )
        else:
            used.add(i)
            merged.append(a)
    return others + merged


def _union_coverage(outer: Box, inner: list[Box], grid: int = 64) -> float:
    """Fraction of ``outer`` covered by the union of ``inner`` boxes (rasterised on a grid)."""
    x0, y0, x1, y1 = outer
    w, h = max(x1 - x0, 1e-6), max(y1 - y0, 1e-6)
    covered = [[False] * grid for _ in range(grid)]
    for bx0, by0, bx1, by1 in inner:
        gx0, gx1 = (
            int(max(0.0, (bx0 - x0) / w) * grid),
            int(min(1.0, (bx1 - x0) / w) * grid),
        )
        gy0, gy1 = (
            int(max(0.0, (by0 - y0) / h) * grid),
            int(min(1.0, (by1 - y0) / h) * grid),
        )
        for gy in range(gy0, gy1):
            row = covered[gy]
            for gx in range(gx0, gx1):
                row[gx] = True
    return sum(map(sum, covered)) / float(grid * grid)


def drop_group_boxes(dets: list[Detection]) -> list[Detection]:
    """Remove boxes that merely enclose several other detections (a whole outfit, a rack of
    jeans, two bags side by side). Grounding DINO often scores such group boxes highest."""
    out: list[Detection] = []
    for big in dets:
        inner = [
            d
            for d in dets
            if d is not big
            and containment(d.box, big.box) >= 0.8
            and 0.1 * area(big.box)
            <= area(d.box)
            <= 0.7 * area(big.box)  # near-duplicates of big don't count
        ]
        distinct: list[Detection] = []
        for d in sorted(inner, key=lambda d: -area(d.box)):
            if all(iou(d.box, k.box) < 0.5 for k in distinct):
                distinct.append(d)
        if (
            len(distinct) >= 2
            and _union_coverage(big.box, [d.box for d in distinct]) >= 0.5
        ):
            continue
        out.append(big)
    return out


def filter_detections(
    dets: list[Detection],
    width: int,
    height: int,
    *,
    max_items: int,
    iou_threshold: float = 0.6,
    min_area_frac: float = 0.004,
) -> list[Detection]:
    """Drop tiny boxes, near-full-frame boxes when others exist, and duplicates (class-agnostic NMS)."""
    img_area = float(width * height)
    min_side = 0.03 * max(width, height)
    dets = [
        d
        for d in dets
        if area(d.box) >= min_area_frac * img_area
        and min(d.box[2] - d.box[0], d.box[3] - d.box[1]) >= min_side
    ]
    if len(dets) > 1:
        dets = [d for d in dets if area(d.box) < 0.95 * img_area] or dets
    dets = drop_group_boxes(dets)
    dets = merge_pairs(dets)
    dets.sort(key=lambda d: -d.score)
    kept: list[Detection] = []
    for d in dets:
        dup = False
        for k in kept:
            if iou(d.box, k.box) >= iou_threshold:
                dup = True
            elif (
                group_of(d.label) == group_of(k.label) != "unknown"
                and max(containment(d.box, k.box), containment(k.box, d.box)) >= 0.85
            ):
                dup = True
            if dup:
                break
        if not dup:
            kept.append(d)
    return kept[:max_items]
