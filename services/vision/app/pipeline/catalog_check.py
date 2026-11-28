"""Checks for catalogue photos of a garment: AI-generated packshots and official store photos.

A catalogue photo is good when it answers two independent questions with "yes":

1. **Presentation** — does it look like a professional product photo? Measured on the image alone:
   * background: the border ring is light and uniform (seamless white / neutral studio);
   * framing: the garment is whole (it does not touch the frame) and fills a sensible share of it;
   * arrangement: the silhouette is left–right symmetric around a vertical axis (sleeves laid out
     the same way, trouser legs side by side) — folded or crumpled sleeves, twisted legs and
     tilted garments break it — and FashionSigLIP rates the photo as a neat packshot rather than a
     crumpled / folded / hanging / worn garment;
   * one item (shoes may come as a pair).
   A garment that only had its background removed keeps its messy arrangement and fails here.

2. **Fidelity** to the real garment — *independent of how it is arranged*, because a packshot
   re-arranges the garment on purpose (so silhouette comparisons such as ``compare.py`` do not
   apply): same type, FashionSigLIP similarity, colour palette (Earth Mover's Distance with
   CIEDE2000 costs; no main colour lost or added), texture (uniform-LBP histograms at the same
   garment scale) and, when the real garment shows text or a logo, the same text (OCR).

Every threshold lives in ``CatalogLimits``; they were calibrated on real generations and on
negative controls (background-removed messy photos, other garments): see
docs/evidence/foto-catalogo-2026-11-24.md.
"""

from __future__ import annotations

import base64
import dataclasses
import difflib
import io
import re
from dataclasses import asdict, dataclass, field
from typing import Any

import cv2
import numpy as np
from PIL import Image

from ..colors import delta_e2000, extract_colors, lab_to_rgb, rgb_to_lab
from ..config import Settings
from ..imaging import composite_on_white, decode_image, pad_to_square, resize_max_side
from ..models.base import VisionBackend
from ..prompts import SUBCATEGORY_PROMPTS
from .analyze import analyze_image
from .classify import classify_embeddings, get_heads
from .masks import (
    clean_mask,
    decontaminate_cutout,
    embedding_view,
    make_cutout,
    mask_bbox,
    upright_angle,
)

# Categories whose product presentation is symmetric about a vertical axis.
SYMMETRIC = {"top", "bottom", "one_piece", "outerwear"}
# Clothing (not accessories): a generated packshot must not add any of these besides the garment.
CLOTHING = {"top", "bottom", "one_piece", "outerwear", "swimwear"}
EXTRA_MIN_AREA = (
    0.08  # box area (fraction of the image) of an added garment that counts
)
PAIRED = {"footwear", "accessory"}  # shoes, earrings, gloves… may show two parts
RING = 0.04  # border ring (fraction of the short side) used for the background


@dataclass(frozen=True)
class CatalogLimits:
    # presentation
    min_background_l: float = 84.0  # mean L* of the border ring
    max_background_l_std: float = 9.0
    max_background_chroma: float = 10.0
    # A studio photo (kind="studio") is only an intermediate step: its plain light grey background
    # is removed afterwards, so it may be greyer and carry a soft light gradient, but no texture.
    studio_min_background_l: float = 60.0
    studio_max_background_l_std: float = 12.0
    # The generator, not a home photo, sets the arrangement and renders the fabric: in the blind review
    # of 2026-11-25, texture, symmetry and "neatness" failures only ever rejected images judged usable
    # (a straw hat's weave, jeans on a hanger), so they are looser for studio photos.
    studio_max_texture_chi2: float = 0.5
    studio_min_symmetry: float = 0.84
    studio_min_neat: float = 0.35
    # The vision-language model now checks the kind of item, so the embedding only has to rule out a
    # different garment (same garment re-arranged: 0.73–0.93; different: 0.42–0.68).
    studio_min_similarity: float = 0.62
    # Part of the garment was hidden in the user's photo (worn, covered, cut): its cutout also holds
    # skin, other clothes or background, and misses whole areas, so it cannot demand the same main
    # colours or the same pattern, only a close overall palette.
    partial_min_similarity: float = 0.55
    partial_max_palette_emd: float = 18.0
    min_margin: float = 0.008  # garment must not touch the frame (fraction of the side)
    min_extent: float = (
        0.42  # bbox long side / image side: not a tiny item in a big frame
    )
    min_symmetry: float = 0.88  # mirror IoU of the silhouette (symmetric categories)
    max_tilt: float = 4.0  # degrees between the symmetry axis and the vertical
    min_neat: float = 0.5  # P(packshot) of the zero-shot presentation head
    max_worn: float = 0.5  # P(person wearing it)
    # fidelity
    min_similarity: float = (
        0.70  # FashionSigLIP cosine with the real garment (re-arranged!)
    )
    # CIEDE2000 with kL = 2 (textile setting), after aligning the overall lightness
    max_palette_emd: float = 10.0
    max_missing_delta_e: float = 15.0  # a main colour (≥ 15 %) needs a match this close
    max_lightness_shift: float = (
        42.0  # studio light may brighten/darken, but not black → white
    )
    main_color_share: float = 0.15
    max_texture_chi2: float = 0.35
    min_text_match: float = 0.5


@dataclass
class Presentation:
    background_l: float
    background_l_std: float
    background_chroma: float
    margin: float
    extent: float
    symmetry: float | None
    tilt: float | None
    components: int
    neat: float
    worn: float
    passed: bool
    reasons: list[str] = field(default_factory=list)
    codes: list[str] = field(default_factory=list)


@dataclass
class Fidelity:
    similarity: float
    category: str | None
    subcategory: str | None
    same_category: bool
    pattern: str | None
    reference_pattern: str | None
    palette_emd: float
    lightness_shift: float
    missing_colors: list[str]
    extra_colors: list[str]
    texture_chi2: float
    reference_text: str | None
    candidate_text: str | None
    text_match: float | None
    passed: bool
    reasons: list[str] = field(default_factory=list)
    codes: list[str] = field(default_factory=list)


@dataclass
class CatalogCheck:
    presentation: Presentation
    fidelity: Fidelity
    bbox: list[float]
    cutout_png_base64: str | None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


# ---------------------------------------------------------------------------
# Presentation
# ---------------------------------------------------------------------------


def background_stats(rgb: np.ndarray, ring: float = RING) -> tuple[float, float, float]:
    """Mean L*, std of L* and mean chroma of the image's border ring."""
    h, w = rgb.shape[:2]
    r = max(2, round(min(h, w) * ring))
    band = np.concatenate(
        [
            rgb[:r].reshape(-1, 3),
            rgb[-r:].reshape(-1, 3),
            rgb[:, :r].reshape(-1, 3),
            rgb[:, -r:].reshape(-1, 3),
        ]
    )
    if band.shape[0] > 20000:
        band = band[:: band.shape[0] // 20000]
    lab = rgb_to_lab(band.astype(np.float64))
    chroma = np.hypot(lab[:, 1], lab[:, 2])
    return float(lab[:, 0].mean()), float(lab[:, 0].std()), float(chroma.mean())


def components(mask: np.ndarray, min_share: float = 0.03) -> int:
    n, _, stats, _ = cv2.connectedComponentsWithStats(mask.astype(np.uint8), 8)
    if n <= 1:
        return 0
    areas = stats[1:, cv2.CC_STAT_AREA]
    return int((areas >= areas.sum() * min_share).sum())


def _garment_noun(subcategory: str | None, category: str | None) -> str:
    if subcategory and subcategory in SUBCATEGORY_PROMPTS:
        return SUBCATEGORY_PROMPTS[subcategory][0]
    return {
        "top": "a top",
        "bottom": "trousers",
        "one_piece": "a dress",
        "outerwear": "a jacket",
        "footwear": "a pair of shoes",
        "accessory": "a bag",
    }.get(category or "", "a garment")


PRESENTATION_PROMPTS: dict[str, tuple[str, ...]] = {
    "packshot": (
        "a professional e-commerce product photo of {g} on a plain white background",
        "a neatly arranged flat lay of {g} on a white background",
        "a ghost mannequin product photo of {g}",
        "a studio catalogue packshot of {g}",
    ),
    "messy": (
        "a crumpled wrinkled {g} lying on a bed",
        "{g} with folded sleeves",
        "a folded {g}",
        "{g} hanging on a hanger",
        "{g} draped over a chair",
        "a casual phone photo of {g} at home",
    ),
    "worn": (
        "a person wearing {g}",
        "a model wearing {g}",
        "a mirror selfie of a person in {g}",
    ),
}


def presentation_probs(
    backend: VisionBackend, image: Image.Image, noun: str, scale: float
) -> dict[str, float]:
    """Zero-shot P(packshot / messy / worn) of the whole image (FashionSigLIP)."""
    ids = list(PRESENTATION_PROMPTS)
    texts = [t.format(g=noun) for k in ids for t in PRESENTATION_PROMPTS[k]]
    temb = backend.embed_texts(texts)
    spans, start = [], 0
    for k in ids:
        spans.append((start, start + len(PRESENTATION_PROMPTS[k])))
        start += len(PRESENTATION_PROMPTS[k])
    protos = np.stack([temb[a:b].mean(axis=0) for a, b in spans])
    protos /= np.maximum(np.linalg.norm(protos, axis=1, keepdims=True), 1e-12)
    iemb = backend.embed_images([pad_to_square(image.convert("RGB"))])[0]
    logits = scale * (protos @ iemb)
    p = np.exp(logits - logits.max())
    p /= p.sum()
    return {k: float(v) for k, v in zip(ids, p)}


def judge_presentation(
    rgb: np.ndarray,
    mask_full: np.ndarray,
    cutout_alpha: np.ndarray,
    category: str | None,
    probs: dict[str, float],
    limits: CatalogLimits,
) -> Presentation:
    h, w = rgb.shape[:2]
    bl, bstd, bchroma = background_stats(rgb)
    ys, xs = np.nonzero(mask_full)
    if ys.size:
        x0, y0, x1, y1 = xs.min(), ys.min(), xs.max() + 1, ys.max() + 1
        margin = float(min(x0 / w, y0 / h, (w - x1) / w, (h - y1) / h))
        extent = float(max((x1 - x0) / w, (y1 - y0) / h))
    else:
        margin, extent = 0.0, 0.0
    hard = cutout_alpha > 127
    symmetric = category in SYMMETRIC
    sym: float | None = None
    tilt: float | None = None
    if symmetric and hard.any():
        angle, _, at_zero = upright_angle(hard)
        sym, tilt = round(at_zero, 4), round(abs(angle), 2)
    n = components(hard)
    reasons: list[str] = []
    codes: list[str] = []
    if (
        bl < limits.min_background_l
        or bstd > limits.max_background_l_std
        or bchroma > limits.max_background_chroma
    ):
        reasons.append("El fondo no es un fondo de estudio liso y claro.")
        codes.append("background")
    if margin < limits.min_margin:
        reasons.append("La prenda está cortada por el borde de la imagen.")
        codes.append("cropped")
    elif extent < limits.min_extent:
        reasons.append("La prenda sale demasiado pequeña en la imagen.")
        codes.append("small")
    if sym is not None and sym < limits.min_symmetry:
        reasons.append(
            "La prenda no está bien colocada: mangas, perneras o laterales no quedan simétricos."
        )
        codes.append("asymmetric")
    if tilt is not None and tilt > limits.max_tilt:
        reasons.append(
            "La prenda está torcida: no está fotografiada de frente y recta."
        )
        codes.append("tilted")
    if n > (2 if category in PAIRED else 1):
        reasons.append("Aparece más de una prenda u objeto.")
        codes.append("multiple")
    if probs.get("worn", 0.0) > limits.max_worn:
        reasons.append("Aparece una persona llevando la prenda.")
        codes.append("worn")
    elif probs.get("packshot", 0.0) < limits.min_neat:
        reasons.append(
            "No parece una foto de producto ordenada (sigue arrugada, doblada o colgada)."
        )
        codes.append("messy")
    return Presentation(
        background_l=round(bl, 2),
        background_l_std=round(bstd, 2),
        background_chroma=round(bchroma, 2),
        margin=round(margin, 4),
        extent=round(extent, 4),
        symmetry=sym,
        tilt=tilt,
        components=n,
        neat=round(probs.get("packshot", 0.0), 4),
        worn=round(probs.get("worn", 0.0), 4),
        passed=not reasons,
        reasons=reasons,
        codes=codes,
    )


# ---------------------------------------------------------------------------
# Fidelity (pose-invariant)
# ---------------------------------------------------------------------------


def _pixels(rgba: Image.Image) -> np.ndarray:
    arr = np.asarray(rgba.convert("RGBA"))
    return arr[arr[..., 3] > 127][:, :3]


def palette(rgba: Image.Image) -> list[tuple[np.ndarray, float, str]]:
    """Garment colours without specular highlights: on a clearly coloured garment (median chroma > 20)
    the brightest 10 % of pixels that are near-neutral are glare (sunlit nylon, satin), not a colour.
    A white part of a two-colour garment is larger than that and stays."""
    px = _pixels(rgba)
    if px.shape[0] >= 64:
        lab = rgb_to_lab(px.astype(np.float64))
        chroma = np.hypot(lab[:, 1], lab[:, 2])
        if np.median(chroma) > 20:
            # At most 10 % of the pixels (ties included): the brightest ones, if near-neutral.
            brightest = np.argsort(lab[:, 0], kind="stable")[
                -max(1, px.shape[0] // 10) :
            ]
            glare = np.zeros(px.shape[0], bool)
            glare[brightest] = chroma[brightest] < 12
            px = px[~glare]
    cols = extract_colors(px, max_colors=5, k=8, min_share=0.04)
    return [(np.array(c.lab), c.share, c.hex) for c in cols]


def median_lightness(rgba: Image.Image) -> float:
    px = _pixels(rgba)
    if px.shape[0] > 40000:
        px = px[:: px.shape[0] // 40000]
    return (
        float(np.median(rgb_to_lab(px.astype(np.float64))[:, 0])) if px.size else 50.0
    )


def shift_lightness(
    pal: list[tuple[np.ndarray, float, str]], shift: float
) -> list[tuple[np.ndarray, float, str]]:
    """A home photo and a studio photo of the same fabric differ in exposure: compare hue and
    chroma as they are, lightness after aligning the garments' median L*."""
    return [
        (np.array([min(100.0, max(0.0, lab[0] + shift)), lab[1], lab[2]]), sh, hx)
        for lab, sh, hx in pal
    ]


def palette_distance(
    a: list[tuple[np.ndarray, float, str]],
    b: list[tuple[np.ndarray, float, str]],
    kl: float = 2.0,
) -> float:
    """Earth Mover's Distance between two palettes with CIEDE2000 ground distance. kL = 2: a home
    photo and a studio photo of the same fabric differ more in lighting than in colour."""
    if not a or not b:
        return 99.0
    cost = np.array(
        [[float(delta_e2000(x[0], y[0], kl)) for y in b] for x in a], np.float32
    )
    wa = np.array([[x[1]] for x in a], np.float32)
    wb = np.array([[y[1]] for y in b], np.float32)
    emd, _, _ = cv2.EMD(wa, wb, cv2.DIST_USER, cost=cost)
    return float(emd)


def unmatched(
    src: list[tuple[np.ndarray, float, str]],
    dst: list[tuple[np.ndarray, float, str]],
    min_share: float,
    max_de: float,
    kl: float = 3.0,
) -> list[str]:
    """Main colours of ``src`` with no counterpart in ``dst``. A colour is its hue and chroma (kL = 3):
    the sunlit side of a garment is not a colour the studio photo has lost."""
    out = []
    for lab, share, hx in src:
        if share < min_share:
            continue
        if not dst or min(float(delta_e2000(lab, d[0], kl)) for d in dst) > max_de:
            out.append(hx)
    return out


def _lbp(gray: np.ndarray) -> np.ndarray:
    """Uniform LBP codes (P=8, R=1) → 0..9; border pixels get 9."""
    g = gray.astype(np.int16)
    c = g[1:-1, 1:-1]
    nb = [
        g[:-2, :-2], g[:-2, 1:-1], g[:-2, 2:], g[1:-1, 2:],
        g[2:, 2:], g[2:, 1:-1], g[2:, :-2], g[1:-1, :-2],
    ]  # fmt: skip
    bits = np.stack([(n >= c).astype(np.uint8) for n in nb])
    ones = bits.sum(axis=0)
    trans = (bits != np.roll(bits, 1, axis=0)).sum(axis=0)
    codes = np.where(trans <= 2, ones, 9).astype(np.uint8)
    out = np.full(gray.shape, 9, np.uint8)
    out[1:-1, 1:-1] = codes
    return out


def texture_hist(rgba: Image.Image, side: int = 320) -> np.ndarray:
    """LBP histogram of the garment's luminance at a fixed garment scale (long side = ``side``)."""
    rgba = rgba.convert("RGBA")
    bbox = rgba.getchannel("A").point(lambda a: 255 if a > 127 else 0).getbbox()
    if bbox:
        rgba = rgba.crop(bbox)
    s = side / max(rgba.size)
    rgba = rgba.resize(
        (max(8, round(rgba.width * s)), max(8, round(rgba.height * s))),
        Image.Resampling.LANCZOS,
    )
    arr = np.asarray(rgba)
    gray = cv2.cvtColor(arr[..., :3], cv2.COLOR_RGB2GRAY)
    mask = (
        cv2.erode((arr[..., 3] > 127).astype(np.uint8), np.ones((5, 5), np.uint8)) > 0
    )
    codes = _lbp(gray)[mask]
    hist = np.bincount(codes, minlength=10).astype(np.float64)[:10]
    return hist / max(hist.sum(), 1.0)


def chi2(a: np.ndarray, b: np.ndarray) -> float:
    s = a + b
    nz = s > 0
    return float(0.5 * np.sum((a[nz] - b[nz]) ** 2 / s[nz]))


_TOKEN = re.compile(r"[A-Za-z0-9ÁÉÍÓÚÜÑáéíóúüñ!?&]{2,}")


def text_tokens(lines: list[Any], min_conf: float = 0.35) -> list[str]:
    toks: list[str] = []
    for ln in lines:
        if ln.confidence >= min_conf:
            toks += [t.upper() for t in _TOKEN.findall(ln.text)]
    return toks


def text_match(ref: list[str], cand: list[str]) -> float | None:
    """Share of the reference's text tokens found (fuzzy) in the candidate."""
    if not ref:
        return None
    hits = 0
    for t in ref:
        if any(difflib.SequenceMatcher(None, t, c).ratio() >= 0.75 for c in cand):
            hits += 1
    return hits / len(ref)


def judge_fidelity(
    *,
    similarity: float,
    category: str | None,
    expected_category: str | None,
    subcategory: str | None,
    pattern: str | None,
    reference_pattern: str | None,
    ref_palette: list[tuple[np.ndarray, float, str]],
    cand_palette: list[tuple[np.ndarray, float, str]],
    lightness_shift: float,
    texture: float,
    ref_text: list[str],
    cand_text: list[str],
    limits: CatalogLimits,
) -> Fidelity:
    aligned = shift_lightness(ref_palette, lightness_shift)
    emd = palette_distance(aligned, cand_palette)
    missing = unmatched(
        aligned, cand_palette, limits.main_color_share, limits.max_missing_delta_e
    )
    extra = unmatched(
        cand_palette, aligned, limits.main_color_share, limits.max_missing_delta_e
    )
    tm = text_match(ref_text, cand_text)
    same = (
        expected_category is None or category is None or category == expected_category
    )
    reasons: list[str] = []
    codes: list[str] = []
    if not same:
        reasons.append("Muestra otro tipo de prenda.")
        codes.append("type")
    if similarity < limits.min_similarity:
        reasons.append("No se parece lo suficiente a tu prenda.")
        codes.append("different")
    if emd > limits.max_palette_emd or missing or extra:
        reasons.append("Ha cambiado los colores de la prenda.")
        codes.append("color")
    elif abs(lightness_shift) > limits.max_lightness_shift:
        reasons.append("La prenda sale mucho más clara u oscura que en tu foto.")
        codes.append("lightness")
    # Plain ↔ patterned only (stripes, checks, florals…): a logo or graphic can look plain or not
    # depending on how folded the photo is, and fine pattern labels are too noisy to compare.
    if (
        pattern
        and reference_pattern
        and pattern != reference_pattern
        and "liso" in {pattern, reference_pattern}
        and "grafico" not in {pattern, reference_pattern}
    ):
        reasons.append("Ha cambiado el estampado (lisa frente a estampada).")
        codes.append("pattern")
    if texture > limits.max_texture_chi2:
        reasons.append("Ha cambiado la textura del tejido.")
        codes.append("texture")
    if tm is not None and tm < limits.min_text_match:
        reasons.append("El texto o logotipo de la prenda no se conserva.")
        codes.append("text")
    return Fidelity(
        similarity=round(similarity, 4),
        category=category,
        subcategory=subcategory,
        same_category=same,
        pattern=pattern,
        reference_pattern=reference_pattern,
        palette_emd=round(emd, 3),
        lightness_shift=round(lightness_shift, 2),
        missing_colors=missing,
        extra_colors=extra,
        texture_chi2=round(texture, 4),
        reference_text=" ".join(ref_text) or None,
        candidate_text=" ".join(cand_text) or None,
        text_match=None if tm is None else round(tm, 3),
        passed=not reasons,
        reasons=reasons,
        codes=codes,
    )


# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------


def _pick_item(
    items: list[dict[str, Any]], category: str | None
) -> dict[str, Any] | None:
    if not items:
        return None
    if category:
        same = [i for i in items if (i.get("category") or {}).get("value") == category]
        if same:
            return same[0]
    return items[0]


def added_garments(
    candidate_bytes: bytes,
    category: str | None,
    backend: VisionBackend,
    settings: Settings,
) -> list[str]:
    """Garments of another kind in a generated packshot (the model dressed the garment as an outfit,
    e.g. a polo with trousers). One silhouette in the single-item analysis; the multi-item detector
    separates them. Accessories are ignored (a belt in jeans, a false «scarf» on a collar)."""
    multi = analyze_image(
        candidate_bytes, mode="multi", max_items=6, backend=backend, settings=settings
    )
    out: list[str] = []
    for it in multi["items"]:
        cat = _value(it.get("category"))
        bx = it.get("bbox") or [0, 0, 0, 0]
        area = (bx[2] - bx[0]) * (bx[3] - bx[1])
        if cat in CLOTHING and cat != category and area >= EXTRA_MIN_AREA:
            out.append(_value(it.get("subcategory")) or cat)
    return out


def _value(field_: dict[str, Any] | None) -> str | None:
    return field_.get("value") if isinstance(field_, dict) else None


# Colour match of a studio photo to the real garment (see match_garment_colour).
DARK_REFERENCE_MAX_L = (
    42.0  # only garments this dark get darkened (mid tones vary with the photo's light)
)
MIN_DARKEN_GAP = 6.0
MAX_DARKEN_GAMMA = 2.5
MIN_LIGHTEN_GAP = (
    15.0  # the generator drew it much darker than the photo (mid-blue jeans → black)
)
MAX_LIGHTEN_REFERENCE_L = 75.0
MIN_LIGHTEN_GAMMA = 0.6
COLOURFUL_CHROMA = 12.0  # median chroma above which a garment's hue is corrected
CHROMA_BLEND = 0.8
MAX_AB_SHIFT = 25.0


def match_garment_colour(
    cutout: Image.Image, reference: Image.Image
) -> tuple[Image.Image, dict[str, float]]:
    """Brings a generated studio cutout back to the colour of the real garment (its cutout from the
    user's photo), in CIELAB, on the garment's pixels only:

    * lightness: a curve L' = 100·(L/100)^γ that maps the body lightness (30th percentile of L*, which
      ignores highlights, logos and white trims) of the generated garment onto the reference. It
      darkens dark garments the small model lit up (a black polo → grey) and lightens coloured
      garments it drew much darker (faded mid-blue jeans → near black); mid tones within 15 L* are
      left alone, since the photo's light varies more than that, and neutral garments are never
      lightened (flash makes black look grey in the photo).
    * hue and saturation, only for clearly coloured garments: the a*/b* mean moves 80 % of the way to
      the reference (at most 25) and the spread is matched (×0.7–1.5), so a cobalt puffer drawn steel
      blue gets its saturation back. Neutral garments (black, grey, white) keep their a*/b*: a home
      photo's warm light must not tint them.
    """
    arr = np.asarray(cutout.convert("RGBA")).copy()
    ref = np.asarray(reference.convert("RGBA"))
    gen_mask = arr[..., 3] > 200
    ref_px = ref[ref[..., 3] > 200][:, :3]
    info = {"gamma": 1.0, "a_shift": 0.0, "b_shift": 0.0}
    if gen_mask.sum() < 400 or ref_px.shape[0] < 400:
        return cutout, info
    if ref_px.shape[0] > 60000:
        ref_px = ref_px[:: ref_px.shape[0] // 60000]
    ref_lab = rgb_to_lab(ref_px.astype(np.float64))
    lab = rgb_to_lab(arr[..., :3].astype(np.float64))
    g = lab[gen_mask]  # statistics from the opaque body…
    paint = (
        arr[..., 3] > 0
    )  # …applied to every visible pixel, soft edge included (no old-colour rim)
    p = lab[paint]
    r_l, g_l = (
        float(np.percentile(ref_lab[:, 0], 30)),
        float(np.percentile(g[:, 0], 30)),
    )
    ref_chroma = float(np.median(np.hypot(ref_lab[:, 1], ref_lab[:, 2])))
    colourful = ref_chroma >= COLOURFUL_CHROMA
    gamma = 1.0
    if 0 < g_l < 100 and 0 < r_l < 100:
        exact = float(np.log(r_l / 100) / np.log(g_l / 100))
        if r_l <= DARK_REFERENCE_MAX_L and g_l - r_l >= MIN_DARKEN_GAP:
            gamma = min(MAX_DARKEN_GAMMA, exact)
        elif (
            colourful
            and r_l - g_l >= MIN_LIGHTEN_GAP
            and r_l <= MAX_LIGHTEN_REFERENCE_L
        ):
            # Only coloured garments: a black one shot with flash measures grey in the photo, and
            # lightening the (correctly black) studio photo to that grey made it worse.
            gamma = max(MIN_LIGHTEN_GAMMA, exact)
    if gamma != 1.0:
        p[:, 0] = 100.0 * (np.clip(p[:, 0], 0, 100) / 100.0) ** gamma
    if colourful:
        # Only the coloured parts are compared and moved: a red hoodie's grey hood lining or a white
        # trim must not be tinted by the red's correction (each pixel weighs by its own chroma).
        g_col = g[np.hypot(g[:, 1], g[:, 2]) >= COLOURFUL_CHROMA]
        r_col = ref_lab[np.hypot(ref_lab[:, 1], ref_lab[:, 2]) >= COLOURFUL_CHROMA]
        if g_col.shape[0] >= 200 and r_col.shape[0] >= 200:
            weight = np.clip((np.hypot(p[:, 1], p[:, 2]) - 6.0) / 12.0, 0.0, 1.0)
            for ch, key in ((1, "a_shift"), (2, "b_shift")):
                gm, gs = float(g_col[:, ch].mean()), float(g_col[:, ch].std()) or 1.0
                rm, rs = float(r_col[:, ch].mean()), float(r_col[:, ch].std()) or 1.0
                shift = float(
                    np.clip(CHROMA_BLEND * (rm - gm), -MAX_AB_SHIFT, MAX_AB_SHIFT)
                )
                k = float(np.clip(rs / gs, 0.7, 1.5))
                moved = (p[:, ch] - gm) * (1 + CHROMA_BLEND * (k - 1)) + gm + shift
                p[:, ch] = p[:, ch] + weight * (moved - p[:, ch])
                info[key] = round(shift, 2)
    info["gamma"] = round(gamma, 3)
    if gamma == 1.0 and not (info["a_shift"] or info["b_shift"]):
        return cutout, info
    arr[..., :3][paint] = np.clip(np.round(lab_to_rgb(p)), 0, 255).astype(np.uint8)
    return Image.fromarray(arr, "RGBA"), info


def _check_studio(
    reference: Image.Image,
    candidate_bytes: bytes,
    *,
    category: str | None,
    subcategory: str | None,
    backend: VisionBackend,
    settings: Settings,
    ocr: bool,
    limits: CatalogLimits,
    colour_fix: bool = True,
    partial: bool = False,
) -> CatalogCheck:
    """A generated studio photo: one item on a plain light grey background. The cutout comes from a
    matting model on the whole image (no detector: there is only one item) and is what the user
    gets, so presentation (except the background) and fidelity are judged on that cutout, after its
    colour is matched to the real garment (``colour_fix``)."""
    s = dataclasses.replace(settings, normalize_cutout=False, upright_correction=False)
    decoded = decode_image(candidate_bytes)
    full, _ = resize_max_side(decoded.rgb, 1024)
    full = full.convert("RGB")
    rgb = np.asarray(full)
    h, w = rgb.shape[:2]
    alpha = np.clip(backend.matte_studio(full), 0.0, 1.0)
    # As for user photos: specks (dust, a vignette corner) and faint haze (a contact shadow) must not
    # set the frame or reach the user's catalogue photo, and edges lose the grey background's halo.
    hard = clean_mask(alpha, 0.5)
    box = mask_bbox(hard)
    if box is None or hard.sum() < 0.01 * h * w:
        return _no_garment(
            reference, rgb, category, backend, full, subcategory, settings, limits
        )
    x0, y0, x1, y1 = box
    mask_full = np.zeros((h, w), bool)
    mask_full[y0:y1, x0:x1] = True
    cutout = decontaminate_cutout(
        make_cutout(
            rgb,
            alpha,
            hard,
            box,
            padding=settings.cutout_padding,
            max_side=settings.cutout_max_side,
        )
    )
    # Not for a garment seen only in part: its reference also holds skin and other clothes, and matching
    # to it would tint the studio photo with them.
    if colour_fix and not partial:
        cutout, _ = match_garment_colour(cutout, reference)
    ref_emb, cand_emb = backend.embed_images(
        [embedding_view(reference), embedding_view(cutout)]
    )
    heads = get_heads(backend, settings)
    ref_attrs, cand_attrs = classify_embeddings(
        heads, np.stack([ref_emb, cand_emb]), settings.thresholds, worn=False
    )
    noun = _garment_noun(subcategory, category)
    # On white, as the user will see it: the zero-shot "packshot" prompts describe a white background.
    probs = presentation_probs(
        backend, composite_on_white(cutout), noun, settings.logit_scale
    )
    studio_limits = dataclasses.replace(
        limits,
        min_background_l=limits.studio_min_background_l,
        max_background_l_std=limits.studio_max_background_l_std,
        max_texture_chi2=limits.studio_max_texture_chi2,
        min_symmetry=limits.studio_min_symmetry,
        min_neat=limits.studio_min_neat,
        min_similarity=limits.studio_min_similarity,
    )
    if partial:
        studio_limits = dataclasses.replace(
            studio_limits,
            min_similarity=limits.partial_min_similarity,
            max_palette_emd=limits.partial_max_palette_emd,
            max_missing_delta_e=1e9,  # no main colour is "lost" or "added"
        )
    cand_category = _value(cand_attrs.get("category"))
    pres = judge_presentation(
        rgb,
        mask_full,
        np.asarray(cutout.getchannel("A")),
        category or cand_category,
        probs,
        studio_limits,
    )
    extra = added_garments(candidate_bytes, category or cand_category, backend, s)
    if extra:
        pres.passed = False
        pres.reasons.append(
            f"Ha añadido otra prenda que no está en tu foto ({', '.join(extra)})."
        )
        pres.codes.append("extra_garment")
    similarity = float(
        np.dot(ref_emb, cand_emb)
        / max(np.linalg.norm(ref_emb) * np.linalg.norm(cand_emb), 1e-12)
    )
    ref_text: list[str] = []
    cand_text: list[str] = []
    if ocr:
        ref_text = text_tokens(backend.ocr(composite_on_white(reference)))
        if ref_text:
            cand_text = text_tokens(backend.ocr(composite_on_white(cutout)))
    fid = judge_fidelity(
        similarity=similarity,
        category=cand_category,
        expected_category=category,
        subcategory=_value(cand_attrs.get("subcategory")),
        pattern=_value(cand_attrs.get("pattern")),
        reference_pattern=None if partial else _value(ref_attrs.get("pattern")),
        ref_palette=palette(reference),
        cand_palette=palette(cutout),
        lightness_shift=median_lightness(cutout) - median_lightness(reference),
        texture=chi2(texture_hist(reference), texture_hist(cutout)),
        ref_text=ref_text,
        cand_text=cand_text,
        limits=studio_limits,
    )
    buf = io.BytesIO()
    cutout.save(buf, format="PNG")
    box = [round(x0 / w, 4), round(y0 / h, 4), round(x1 / w, 4), round(y1 / h, 4)]
    return CatalogCheck(pres, fid, box, base64.b64encode(buf.getvalue()).decode())


def _no_garment(
    reference: Image.Image,
    rgb: np.ndarray,
    category: str | None,
    backend: VisionBackend,
    full: Image.Image,
    subcategory: str | None,
    settings: Settings,
    limits: CatalogLimits,
) -> CatalogCheck:
    h, w = rgb.shape[:2]
    probs = presentation_probs(
        backend, full, _garment_noun(subcategory, category), settings.logit_scale
    )
    empty_p = judge_presentation(
        rgb, np.zeros((h, w), bool), np.zeros((1, 1), np.uint8), category, probs, limits
    )
    empty_p.passed = False
    empty_p.reasons.append("No se distingue ninguna prenda en la imagen.")
    empty_p.codes.append("no_garment")
    empty_f = judge_fidelity(
        similarity=0.0, category=None, expected_category=category, subcategory=None, pattern=None,
        reference_pattern=None, ref_palette=palette(reference), cand_palette=[], lightness_shift=0.0, texture=1.0,
        ref_text=[], cand_text=[], limits=limits,
    )  # fmt: skip
    return CatalogCheck(empty_p, empty_f, [0, 0, 0, 0], None)


def check_catalog_photo(
    reference: Image.Image,
    candidate_bytes: bytes,
    *,
    kind: str,
    category: str | None,
    subcategory: str | None,
    backend: VisionBackend,
    settings: Settings,
    ocr: bool = False,
    limits: CatalogLimits | None = None,
    colour_fix: bool = True,
    partial: bool = False,
) -> CatalogCheck:
    """``kind``: ``generated`` (a packshot made from the user's photo), ``studio`` (a studio photo
    made from it, cut out here afterwards) or ``official`` (a store photo, possibly worn by a model:
    the garment of ``category`` is picked among the detected items)."""
    limits = limits or CatalogLimits()
    if kind == "studio":
        return _check_studio(
            reference, candidate_bytes, category=category, subcategory=subcategory,
            backend=backend, settings=settings, ocr=ocr, limits=limits, colour_fix=colour_fix,
        partial=partial,
        )  # fmt: skip
    # The candidate keeps its pixels and orientation: no colour normalisation (it is already a
    # product photo) and no upright correction (a tilted packshot must be caught, not fixed).
    s = dataclasses.replace(settings, normalize_cutout=False, upright_correction=False)
    analysis = analyze_image(
        candidate_bytes,
        mode="multi" if kind == "official" else "single",
        max_items=6 if kind == "official" else 1,
        backend=backend,
        settings=s,
    )
    item = _pick_item(analysis["items"], category)
    decoded = decode_image(candidate_bytes)
    full, _ = resize_max_side(decoded.rgb, 1024)
    rgb = np.asarray(full.convert("RGB"))
    h, w = rgb.shape[:2]
    noun = _garment_noun(subcategory, category)
    probs = presentation_probs(backend, full, noun, settings.logit_scale)
    if item is None or not item.get("cutout_png_base64"):
        empty_p = judge_presentation(
            rgb,
            np.zeros((h, w), bool),
            np.zeros((1, 1), np.uint8),
            category,
            probs,
            limits,
        )
        empty_p.passed = False
        empty_p.reasons.append("No se distingue ninguna prenda en la imagen.")
        empty_p.codes.append("no_garment")
        empty_f = judge_fidelity(
            similarity=0.0, category=None, expected_category=category, subcategory=None, pattern=None,
            reference_pattern=None, ref_palette=palette(reference), cand_palette=[], lightness_shift=0.0, texture=1.0,
            ref_text=[], cand_text=[], limits=limits,
        )  # fmt: skip
        return CatalogCheck(empty_p, empty_f, [0, 0, 0, 0], None)

    cutout = Image.open(
        io.BytesIO(base64.b64decode(item["cutout_png_base64"]))
    ).convert("RGBA")
    # Garment box in the candidate's frame (normalised) → mask for the framing checks.
    bx = item.get("bbox") or [0, 0, 1, 1]
    mask_full = np.zeros((h, w), bool)
    mask_full[
        round(bx[1] * h) : max(round(bx[1] * h) + 1, round(bx[3] * h)),
        round(bx[0] * w) : max(round(bx[0] * w) + 1, round(bx[2] * w)),
    ] = True
    alpha = np.asarray(cutout.getchannel("A"))
    pres = judge_presentation(
        rgb, mask_full, alpha, category or _value(item.get("category")), probs, limits
    )
    if kind == "generated":
        extra = added_garments(
            candidate_bytes, category or _value(item.get("category")), backend, s
        )
        if extra:
            pres.passed = False
            pres.reasons.append(
                f"Ha añadido otra prenda que no está en tu foto ({', '.join(extra)})."
            )
            pres.codes.append("extra_garment")

    ref_emb, cand_emb = backend.embed_images(
        [embedding_view(reference), embedding_view(cutout)]
    )
    similarity = float(
        np.dot(ref_emb, cand_emb)
        / max(np.linalg.norm(ref_emb) * np.linalg.norm(cand_emb), 1e-12)
    )
    heads = get_heads(backend, settings)
    ref_attrs = classify_embeddings(
        heads, ref_emb[None, :], settings.thresholds, worn=False
    )[0]
    ref_text: list[str] = []
    cand_text: list[str] = []
    if ocr:
        ref_text = text_tokens(backend.ocr(composite_on_white(reference)))
        if ref_text:
            cand_text = text_tokens(backend.ocr(composite_on_white(cutout)))
    fid = judge_fidelity(
        similarity=similarity,
        category=_value(item.get("category")),
        expected_category=category,
        subcategory=_value(item.get("subcategory")),
        pattern=_value(item.get("pattern")),
        reference_pattern=_value(ref_attrs.get("pattern")),
        ref_palette=palette(reference),
        cand_palette=palette(cutout),
        lightness_shift=median_lightness(cutout) - median_lightness(reference),
        texture=chi2(texture_hist(reference), texture_hist(cutout)),
        ref_text=ref_text,
        cand_text=cand_text,
        limits=limits,
    )
    return CatalogCheck(
        pres, fid, [round(float(v), 4) for v in bx], item["cutout_png_base64"]
    )
