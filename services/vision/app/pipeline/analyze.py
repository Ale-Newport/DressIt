"""``/v1/analyze`` orchestration.

decode (EXIF) → gentle auto-crop → scene type (single / multiple / worn) → regions:
  * single garment photo → salient-object background removal (rembg), in parallel
    with region proposals (Grounding DINO + SAM 2.1); display supports (hanger,
    mannequin/head form, clothesline, pegs) verified by FashionSigLIP are removed,
    and thin structures crossing the frame border too (refine.py)
  * multi mode, or a worn/flat-lay photo in single mode → Grounding DINO boxes →
    SAM 2.1 box-prompted masks
→ cutouts (+ mild WB/exposure normalisation) → FashionSigLIP embeddings (one
batch) → zero-shot heads with abstention → layering (a recognised garment inside
another one is subtracted from it; multi and single) → item selection (single:
the main garment; multi: drop non-garments / duplicates) → edge colour
decontamination of the returned cutouts → colours + quality for the kept items.
"""

from __future__ import annotations

import time
from concurrent.futures import Future, ThreadPoolExecutor
from contextlib import contextmanager
from dataclasses import dataclass, field
from typing import Any, Iterator

import numpy as np
from PIL import Image

from .. import quality as Q
from ..colors import extract_colors
from ..config import Settings
from ..hashing import phash, sha256_hex
from ..imaging import content_box, decode_image, encode_png_base64, normalize_cutout_colors, pad_to_square, resize_max_side
from ..models.base import Detection, VisionBackend
from ..prompts import DETECTION_QUERIES
from .classify import classify_embeddings, get_heads, headwear_probability
from .detect import filter_detections, group_of
from .masks import clean_mask, crop_with_fill, decontaminate_cutout, embedding_view, make_cutout, mask_bbox, mask_iou, padded_box, touches_border
from .refine import Proposal, propose_regions, remove_border_lines, remove_supports

SCENE_MIN_CONFIDENCE = 0.5
MIN_MASK_FRAC = 0.002  # of the analysed region
MULTI_MIN_DET_SCORE_UNCLASSIFIED = 0.35  # multi: keep a box without category only if the detector is this sure
MULTI_MIN_DET_SCORE_VAGUE_ACCESSORY = 0.3  # multi: "accessory" without subcategory needs a surer box
CONTAINED_DUPLICATE = 0.7
# Region proposals run on the detector while rembg runs on onnxruntime (different devices).
_POOL = ThreadPoolExecutor(max_workers=4, thread_name_prefix="vision-stage")


class Timer:
    def __init__(self) -> None:
        self.ms: dict[str, float] = {}
        self._t0 = time.perf_counter()

    @contextmanager
    def stage(self, name: str) -> Iterator[None]:
        t = time.perf_counter()
        try:
            yield
        finally:
            self.ms[name] = round(self.ms.get(name, 0.0) + (time.perf_counter() - t) * 1000, 1)

    def total(self) -> dict[str, float]:
        out = dict(self.ms)
        out["total"] = round((time.perf_counter() - self._t0) * 1000, 1)
        return out


@dataclass(eq=False)  # identity semantics (holds numpy arrays)
class Candidate:
    prob: np.ndarray  # soft foreground, region coords
    mask: np.ndarray  # cleaned hard mask, region coords
    det: Detection | None = None
    warnings: list[str] = field(default_factory=list)
    # filled by _prepare / classification
    bbox: tuple[int, int, int, int] = (0, 0, 0, 0)
    crop_box: tuple[int, int, int, int] = (0, 0, 0, 0)
    crop_rgb: np.ndarray | None = None  # normalised pixels of crop_box
    crop_mask: np.ndarray | None = None
    cutout: Image.Image | None = None
    attrs: dict[str, Any] = field(default_factory=dict)
    not_garment: float = 0.0
    embedding: np.ndarray | None = None
    modified: bool = False  # mask reduced by layering


def _scene(backend: VisionBackend, settings: Settings, region: Image.Image) -> tuple[str, float, np.ndarray]:
    heads = get_heads(backend, settings)
    emb = backend.embed_images([pad_to_square(region)])
    p = heads.scene.probs(emb)[0]
    i = int(np.argmax(p))
    return heads.scene.ids[i], float(p[i]), emb[0]


def _from_foreground(backend: VisionBackend, region: Image.Image, alpha: np.ndarray | None) -> Candidate | None:
    prob = (alpha.astype(np.float32) / 255.0) if alpha is not None else backend.remove_background(region)
    mask = clean_mask(prob)
    if mask.sum() < MIN_MASK_FRAC * mask.size:
        return None
    return Candidate(prob=prob, mask=mask)


def _refine_foreground(
    c: Candidate, backend: VisionBackend, settings: Settings, region: Image.Image, props: list[Proposal], headwear: bool
) -> None:
    """Remove display supports (hanger, mannequin, clothesline, pegs) from a rembg mask."""
    prob, _ = remove_supports(backend, settings, region, remove_border_lines(settings, c.prob), props, headwear=headwear)
    if prob is c.prob:
        return
    mask = clean_mask(prob)
    if mask.sum() >= MIN_MASK_FRAC * mask.size:
        c.prob, c.mask = prob, mask


def _from_detections(backend: VisionBackend, settings: Settings, region: Image.Image, max_items: int) -> list[Candidate]:
    w, h = region.size
    dets = backend.detect(region, DETECTION_QUERIES, settings.thresholds.detection)
    dets = filter_detections(dets, w, h, max_items=max_items * 2)
    if not dets:
        return []
    probs = backend.segment_boxes(region, [d.box for d in dets])
    out: list[Candidate] = []
    for det, prob in zip(dets, probs):
        x0, y0, x1, y1 = (int(round(v)) for v in det.box)
        # Keep the mask inside a slightly expanded box: SAM sometimes leaks onto the wearer.
        pad = int(0.03 * max(x1 - x0, y1 - y0))
        gate = np.zeros(prob.shape, dtype=bool)
        gate[max(0, y0 - pad) : y1 + pad, max(0, x0 - pad) : x1 + pad] = True
        prob = np.where(gate, prob, 0.0).astype(np.float32)
        mask = clean_mask(prob, keep_ratio=0.25 if group_of(det.label) == "footwear" else 0.5)
        if mask.sum() < MIN_MASK_FRAC * mask.size:
            continue
        out.append(Candidate(prob=prob, mask=mask, det=det))
    out.sort(key=lambda c: -(c.det.score if c.det else 0.0))
    kept: list[Candidate] = []
    for c in out:  # the same pixels found by two queries ("shirt" and "jacket")
        if all(mask_iou(c.mask, k.mask) < 0.7 for k in kept):
            kept.append(c)
    return kept


def _cat(c: Candidate) -> str | None:
    cat = c.attrs.get("category")
    return cat["value"] if cat else None


CLOTHING = frozenset({"top", "bottom", "one_piece", "outerwear"})


def _layer(cands: list[Candidate], *, clothing_only: bool = False) -> list[Candidate]:
    """Layering after classification: a bigger mask that swallows a smaller garment of a
    *different predicted category* (open jacket over shorts, a whole-outfit box) loses
    those pixels, so every garment keeps its own. Returns the modified candidates.

    ``clothing_only`` (single mode): only clothing is subtracted — the jeans under a
    puffer jacket — not accessories, which in a single-garment photo are more often a part
    of the garment itself (a skirt's waistband taken for a belt)."""
    order = sorted(cands, key=lambda c: -int(c.mask.sum()))
    changed: list[Candidate] = []
    for i, big in enumerate(order):
        for small in order[i + 1 :]:
            # Only a confidently recognised garment (with subcategory) is "on top" of another one.
            if small.attrs.get("subcategory") is None or _cat(big) == _cat(small):
                continue
            if clothing_only and _cat(small) not in CLOTHING:
                continue
            inside = np.logical_and(big.mask, small.mask).sum() / max(1, int(small.mask.sum()))
            if inside >= 0.6:
                big.prob = np.where(small.mask, 0.0, big.prob).astype(np.float32)
                big.mask = clean_mask(big.prob, keep_ratio=0.1)  # an open jacket splits in two halves
                big.modified = True
                if big not in changed:
                    changed.append(big)
    return changed


def _embed_and_classify(cands: list[Candidate], backend: VisionBackend, settings: Settings, worn: bool) -> None:
    if not cands:
        return
    emb = backend.embed_images([embedding_view(c.cutout) for c in cands])
    heads = get_heads(backend, settings)
    for c, vec, attrs in zip(cands, emb, classify_embeddings(heads, emb, settings.thresholds, worn=worn)):
        c.not_garment = float(attrs.pop("_not_garment"))
        c.attrs = attrs
        c.embedding = vec


def _prepare(c: Candidate, rgb: np.ndarray, settings: Settings) -> bool:
    bbox = mask_bbox(c.mask)
    if bbox is None:
        return False
    c.bbox = bbox
    # Local crop around the item (context for white balance; cheaper than the full frame).
    c.crop_box = padded_box(bbox, max(settings.cutout_padding, 0.08))
    crop = crop_with_fill(rgb, c.crop_box, 255)
    crop_mask = crop_with_fill(c.mask, c.crop_box, False)
    crop_prob = crop_with_fill(c.prob, c.crop_box, 0.0)
    if settings.normalize_cutout:
        crop, _ = normalize_cutout_colors(crop, crop_mask)
    c.crop_rgb, c.crop_mask = crop, crop_mask
    ox, oy = c.crop_box[0], c.crop_box[1]
    local_bbox = (bbox[0] - ox, bbox[1] - oy, bbox[2] - ox, bbox[3] - oy)
    c.cutout = make_cutout(crop, crop_prob, crop_mask, local_bbox, padding=settings.cutout_padding, max_side=settings.cutout_max_side)
    return True


def _main_score(c: Candidate, w: int, h: int) -> float:
    ys, xs = np.nonzero(c.mask)
    cx, cy = xs.mean() / w, ys.mean() / h
    centrality = 1.0 - min(1.0, float(np.hypot(cx - 0.5, cy - 0.5)) / 0.7)
    cat = c.attrs.get("category")
    if cat is not None:
        garmentness = cat["confidence"]
    else:  # unclassified: trust the detector's coarse group a little (a skirt box beats a shoe)
        clothing_box = c.det is not None and group_of(c.det.label) in {"top", "outer", "one_piece", "bottom"}
        garmentness = 0.3 if clothing_box else 0.1
    garmentness *= 1.0 - c.not_garment
    clothing = 1.0 if (cat is None or cat["value"] in {"top", "bottom", "one_piece", "outerwear"}) else 0.7
    return float(np.sqrt(c.mask.mean()) * (0.5 + 0.5 * centrality) * garmentness * clothing)


def _drop_contained_duplicates(cands: list[Candidate]) -> list[Candidate]:
    """Multi mode: a mask mostly inside a bigger one is a fragment (a fold of a skirt, one
    shoe of a pair already found) unless it is a *different*, confidently recognised item."""
    order = sorted(cands, key=lambda c: -c.mask.sum())
    kept: list[Candidate] = []
    for c in order:
        dup = False
        for k in kept:
            inter = np.logical_and(c.mask, k.mask).sum() / max(1, c.mask.sum())
            distinct_item = c.attrs.get("subcategory") is not None and _cat(c) != _cat(k)
            if inter >= CONTAINED_DUPLICATE and not distinct_item:
                dup = True
                break
        if not dup:
            kept.append(c)
    return kept


def _keep_in_multi(c: Candidate, th: Any) -> bool:
    if c.not_garment >= th.not_garment:
        return False
    cat = c.attrs.get("category")
    det_score = c.det.score if c.det is not None else 0.0
    if cat is None:  # unclassified: only an untouched, confident detection survives (user labels it)
        return not c.modified and det_score >= MULTI_MIN_DET_SCORE_UNCLASSIFIED
    if cat["value"] == "accessory" and c.attrs.get("subcategory") is None:
        return det_score >= MULTI_MIN_DET_SCORE_VAGUE_ACCESSORY  # "accessory" is the catch-all bin
    return True


def analyze_image(data: bytes, *, mode: str, max_items: int, backend: VisionBackend, settings: Settings) -> dict[str, Any]:
    timer = Timer()
    th = settings.thresholds
    with timer.stage("decode"):
        decoded = decode_image(data)
        image_info = {
            "width": decoded.rgb.size[0],
            "height": decoded.rgb.size[1],
            "sha256": sha256_hex(data),
            "phash": phash(decoded.rgb),
            "exif_transposed": decoded.exif_transposed,
        }
        work, scale = resize_max_side(decoded.rgb, settings.working_max_side)
        rgb_full = np.asarray(work)
        alpha_full = None
        if decoded.alpha is not None:
            alpha_full = np.asarray(Image.fromarray(decoded.alpha).resize(work.size, Image.Resampling.BILINEAR))
        work_w, work_h = work.size

    with timer.stage("autocrop"):
        cx0, cy0, cx1, cy1 = content_box(rgb_full) if alpha_full is None else (0, 0, work_w, work_h)
        rgb = np.ascontiguousarray(rgb_full[cy0:cy1, cx0:cx1])
        alpha = alpha_full[cy0:cy1, cx0:cx1] if alpha_full is not None else None
        region = Image.fromarray(rgb)
        rw, rh = region.size

    scene: dict[str, Any] | None = None
    region_emb: np.ndarray | None = None
    if alpha is None:
        with timer.stage("scene"):
            s_id, s_conf, region_emb = _scene(backend, settings, region)
            scene = {"value": s_id, "confidence": round(s_conf, 4)}
    worn = scene is not None and scene["value"] == "worn" and scene["confidence"] >= SCENE_MIN_CONFIDENCE

    cands: list[Candidate] = []
    use_detector = alpha is None and (
        mode == "multi" or (scene is not None and scene["value"] in {"worn", "multiple"} and scene["confidence"] >= SCENE_MIN_CONFIDENCE)
    )
    if use_detector:
        with timer.stage("detect_segment"):
            cands = _from_detections(backend, settings, region, max_items)
    if mode == "single" and not cands:
        proposals: Future[list[Proposal]] | None = None
        with timer.stage("background_removal"):
            if alpha is None and settings.remove_supports and not worn:  # supports: products, not worn photos
                proposals = _POOL.submit(propose_regions, backend, settings, region)
            c = _from_foreground(backend, region, alpha)
            props = proposals.result() if proposals is not None else []
        if c is None:  # nothing separable: analyse the whole frame, flagged
            c = Candidate(prob=np.ones((rh, rw), np.float32), mask=np.ones((rh, rw), bool), warnings=[Q.WARN_MASK])
        elif proposals is not None:
            with timer.stage("supports"):
                headwear = region_emb is not None and headwear_probability(get_heads(backend, settings), region_emb) >= 0.5
                _refine_foreground(c, backend, settings, region, props, headwear)
        cands = [c]

    with timer.stage("cutout"):
        cands = [c for c in cands if _prepare(c, rgb, settings)]

    with timer.stage("embed_classify"):
        _embed_and_classify(cands, backend, settings, worn)
    if len(cands) > 1 and (mode == "multi" or settings.layer_single):
        with timer.stage("layering"):
            changed = [c for c in _layer(cands, clothing_only=mode == "single") if c.mask.sum() >= MIN_MASK_FRAC * c.mask.size and _prepare(c, rgb, settings)]
            cands = [c for c in cands if not c.modified or c in changed]
            _embed_and_classify(changed, backend, settings, worn)

    if mode == "single" and len(cands) > 1:
        cands = [max(cands, key=lambda c: _main_score(c, rw, rh))]
    elif mode == "multi":
        cands = [c for c in cands if _keep_in_multi(c, th)]
        cands = _drop_contained_duplicates(cands)
        cands.sort(key=lambda c: -((c.det.score if c.det else 0.5) * np.sqrt(c.mask.mean())))
        cands = cands[:max_items]

    if settings.decontaminate_edges:
        with timer.stage("edges"):  # only the returned cutouts (the classifier saw them on white)
            for c in cands:
                c.cutout = decontaminate_cutout(c.cutout)

    items: list[dict[str, Any]] = []
    with timer.stage("colors_quality"):
        for c in cands:
            x0, y0, x1, y1 = c.bbox
            ox, oy = c.crop_box[0], c.crop_box[1]
            lb = (x0 - ox, y0 - oy, x1 - ox, y1 - oy)
            crop_rgb = c.crop_rgb[lb[1] : lb[3], lb[0] : lb[2]]
            crop_mask = c.crop_mask[lb[1] : lb[3], lb[0] : lb[2]]
            colors = [col.to_dict() for col in extract_colors(crop_rgb[crop_mask])]
            mask_area_ratio = float(c.mask.sum()) / float(work_w * work_h)
            q = Q.assess_quality(
                crop_rgb,
                crop_mask,
                source_long_side_px=int(max(x1 - x0, y1 - y0) / max(scale, 1e-6)),
                mask_area_ratio=mask_area_ratio,
                touches_border=touches_border(c.mask),
                mask_suspicious=bool(crop_mask.mean() > 0.97 and c.mask.mean() > 0.9),
            )
            for w_ in c.warnings:
                if w_ not in q.warnings:
                    q.warnings.append(w_)
            if c.attrs["category"] is None:
                q.warnings.append(Q.WARN_NOT_GARMENT if c.not_garment >= th.not_garment else Q.WARN_UNSURE)
            items.append(
                {
                    "bbox": [
                        round(float(x0 + cx0) / work_w, 4),
                        round(float(y0 + cy0) / work_h, 4),
                        round(float(x1 + cx0) / work_w, 4),
                        round(float(y1 + cy0) / work_h, 4),
                    ],
                    "cutout_png_base64": encode_png_base64(c.cutout),
                    "mask_area_ratio": round(mask_area_ratio, 4),
                    "detection_score": round(float(c.det.score), 4) if c.det else None,
                    "category": c.attrs["category"],
                    "subcategory": c.attrs["subcategory"],
                    "colors": colors,
                    "pattern": c.attrs["pattern"],
                    "materials": c.attrs["materials"],
                    "styles": c.attrs["styles"],
                    "seasons": c.attrs["seasons"],
                    "fit": c.attrs["fit"],
                    "embedding": [round(float(v), 6) for v in c.embedding],
                    "embedding_model": backend.embedding_model_id,
                    "quality": q.to_dict(),
                }
            )

    return {
        "image": image_info,
        "items": items,
        "scene": scene,
        "timings_ms": timer.total(),
        "model_versions": backend.model_versions(),
    }
