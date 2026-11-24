"""Zero-shot attribute heads on FashionSigLIP embeddings, with calibration and abstention.

Each head holds one prototype per vocabulary id (L2-normalised mean of the
text embeddings of its English prompt ensemble). For an image embedding ``e``
the class distribution is ``softmax(s · cos(e, prototypes))`` where ``s`` is a
per-head scale fitted by NLL on the calibration split (``app/calibration.json``,
produced by ``scripts/calibrate.py``). Every head then applies an explicit
per-attribute threshold and returns ``None`` when it is not confident enough:
the service never invents attributes.
"""

from __future__ import annotations

import json
import os
import threading
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any

import numpy as np

from .. import prompts as P
from ..config import Settings, Thresholds
from ..vocabulary import Vocabulary, load_vocabulary

CALIBRATION_PATH = Path(__file__).resolve().parent.parent / "calibration.json"
DEFAULT_SCALES: dict[str, float] = {
    "garment": 50.0,
    "pattern": 50.0,
    "material": 50.0,
    "style": 50.0,
    "warmth": 50.0,
    "fit": 50.0,
    "scene": 50.0,
}
FIT_CATEGORIES = frozenset({"top", "bottom", "one_piece", "outerwear"})
# Definitional material implications (only used when the subcategory itself is confident).
SUBCATEGORY_MATERIALS: dict[str, tuple[str, ...]] = {
    "vaquero": ("denim",),
    "cazadora_vaquera": ("denim",),
    "chaqueta_cuero": ("cuero",),
    "jersey": ("punto",),
    "jersey_grueso": ("punto",),
    "cardigan": ("punto",),
    "chaleco_punto": ("punto",),
    "vestido_punto": ("punto",),
    "zapatillas_lona": ("lona",),
}
STYLE_PRIOR_WEIGHT = 0.7  # vocabulary style affinities vs. zero-shot style evidence
MAX_STYLES = 3
ALT_COUNT = 3
ALT_MIN = 0.02


@lru_cache(maxsize=1)
def load_scales() -> dict[str, float]:
    scales = dict(DEFAULT_SCALES)
    if CALIBRATION_PATH.exists():
        data = json.loads(CALIBRATION_PATH.read_text(encoding="utf-8"))
        scales.update({k: float(v) for k, v in (data.get("scales") or {}).items()})
    return scales


@dataclass
class Head:
    name: str
    ids: list[str]
    prototypes: np.ndarray  # (C, D)
    scale: float

    def probs(self, embeddings: np.ndarray) -> np.ndarray:
        logits = self.scale * (np.atleast_2d(embeddings) @ self.prototypes.T)
        logits -= logits.max(axis=1, keepdims=True)
        p = np.exp(logits)
        return p / p.sum(axis=1, keepdims=True)


def _texts(
    class_prompts: dict[str, tuple[str, ...]], templates: tuple[str, ...]
) -> dict[str, list[str]]:
    return {cid: P.ensemble(names, templates) for cid, names in class_prompts.items()}


def _build_head(
    backend: Any, name: str, class_texts: dict[str, list[str]], scale: float
) -> Head:
    ids = list(class_texts)
    texts: list[str] = []
    spans: list[tuple[int, int]] = []
    for cid in ids:
        start = len(texts)
        texts.extend(class_texts[cid])
        spans.append((start, len(texts)))
    emb = backend.embed_texts(texts)
    protos = np.stack([emb[a:b].mean(axis=0) for a, b in spans])
    protos /= np.maximum(np.linalg.norm(protos, axis=1, keepdims=True), 1e-12)
    return Head(name=name, ids=ids, prototypes=protos.astype(np.float32), scale=scale)


class ZeroShotHeads:
    """All heads for one backend; text prototypes are computed once and cached."""

    def __init__(
        self, backend: Any, settings: Settings, vocab: Vocabulary | None = None
    ) -> None:
        self.vocab = vocab or load_vocabulary()
        scales = load_scales()
        override = (
            settings.logit_scale if os.environ.get("VISION_LOGIT_SCALE") else None
        )

        def sc(name: str) -> float:
            return (
                float(override)
                if override is not None
                else scales.get(name, DEFAULT_SCALES[name])
            )

        garment = _texts(
            {s.id: P.SUBCATEGORY_PROMPTS[s.id] for s in self.vocab.subcategories},
            P.GARMENT_TEMPLATES,
        )
        for (
            rid,
            texts,
        ) in P.NOT_GARMENT_PROMPTS.items():  # reject classes: no garment templates
            garment[rid] = list(texts)
        self.garment = _build_head(backend, "garment", garment, sc("garment"))
        self.pattern = _build_head(
            backend,
            "pattern",
            _texts(
                {p.id: P.PATTERN_PROMPTS[p.id] for p in self.vocab.patterns},
                P.PATTERN_TEMPLATES,
            ),
            sc("pattern"),
        )
        self.material = _build_head(
            backend,
            "material",
            _texts(
                {m.id: P.MATERIAL_PROMPTS[m.id] for m in self.vocab.materials},
                P.MATERIAL_TEMPLATES,
            ),
            sc("material"),
        )
        self.style = _build_head(
            backend,
            "style",
            _texts(
                {s: P.STYLE_PROMPTS[s] for s in self.vocab.styles}, P.STYLE_TEMPLATES
            ),
            sc("style"),
        )
        self.warmth = _build_head(
            backend,
            "warmth",
            _texts(P.WARMTH_PROMPTS, P.WARMTH_TEMPLATES),
            sc("warmth"),
        )
        self.fit = _build_head(
            backend,
            "fit",
            _texts({f: P.FIT_PROMPTS[f] for f in self.vocab.fits}, P.FIT_TEMPLATES),
            sc("fit"),
        )
        self.scene = _build_head(
            backend, "scene", _texts(P.SCENE_PROMPTS, P.SCENE_TEMPLATES), sc("scene")
        )
        # Support verification (single mode): the garment classes (subcategories + reject
        # classes) compete with garment parts and display supports in one softmax.
        extra = _texts(
            {**P.GARMENT_PART_PROMPTS, **P.SUPPORT_PROMPTS}, P.SUPPORT_TEMPLATES
        )
        extra_head = _build_head(backend, "support_extra", extra, sc("garment"))
        self.support = Head(
            name="support",
            ids=self.garment.ids + extra_head.ids,
            prototypes=np.vstack([self.garment.prototypes, extra_head.prototypes]),
            scale=sc("garment"),
        )
        self.support_idx = np.array(
            [i for i, c in enumerate(self.support.ids) if c.startswith("__support__")],
            dtype=int,
        )
        self.form_idx = np.array(
            [
                self.support.ids.index(c)
                for c in ("__support__mannequin", "__support__form")
            ],
            dtype=int,
        )
        self.style_prior = np.array(
            [
                [s.styles.get(st, 0.0) for st in self.vocab.styles]
                for s in self.vocab.subcategories
            ],
            dtype=np.float64,
        )


_heads_lock = threading.Lock()
_heads_cache: dict[int, ZeroShotHeads] = {}


def get_heads(backend: Any, settings: Settings) -> ZeroShotHeads:
    key = id(backend)
    if key not in _heads_cache:
        with _heads_lock:
            if key not in _heads_cache:
                _heads_cache[key] = ZeroShotHeads(backend, settings)
    return _heads_cache[key]


HEADWEAR = frozenset({"gorro", "gorra", "sombrero"})


def headwear_probability(heads: ZeroShotHeads, embedding: np.ndarray) -> float:
    """P(the photo shows a hat/cap/beanie) from the whole-photo embedding (hat on a head form)."""
    p = heads.garment.probs(embedding[None])[0]
    return float(sum(p[i] for i, c in enumerate(heads.garment.ids) if c in HEADWEAR))


def support_probability(
    heads: ZeroShotHeads, embeddings: np.ndarray
) -> tuple[np.ndarray, np.ndarray]:
    """Per region embedding: P(display support: hanger, mannequin/form, clothesline, peg/hook)
    and whether the single most likely class is a mannequin or head form."""
    if len(embeddings) == 0:
        return np.zeros(0, np.float32), np.zeros(0, bool)
    p = heads.support.probs(embeddings)
    return p[:, heads.support_idx].sum(axis=1).astype(np.float32), np.isin(
        p.argmax(axis=1), heads.form_idx
    )


# ---------------------------------------------------------------------------
# Decision rules (pure functions → unit-testable without any model)
# ---------------------------------------------------------------------------


def _field(
    value: Any, confidence: float, alternatives: list[tuple[Any, float]] | None = None
) -> dict[str, Any]:
    return {
        "value": value,
        "confidence": round(float(confidence), 4),
        "alternatives": [
            {"value": v, "confidence": round(float(c), 4)}
            for v, c in (alternatives or [])
        ],
    }


def _alternatives(
    ids: list[str], probs: np.ndarray, exclude: str | None
) -> list[tuple[str, float]]:
    order = np.argsort(-probs)
    out = [
        (ids[i], float(probs[i]))
        for i in order
        if ids[i] != exclude and probs[i] >= ALT_MIN
    ]
    return out[:ALT_COUNT]


@dataclass
class GarmentDecision:
    category: dict[str, Any] | None
    subcategory: dict[str, Any] | None
    not_garment: float
    sub_probs: (
        np.ndarray
    )  # garment-conditional distribution over subcategories (sums to 1)
    category_id: str | None
    subcategory_id: str | None


def decide_garment(
    p: np.ndarray, sub_ids: list[str], sub_categories: list[str], th: Thresholds
) -> GarmentDecision:
    """``p`` is the distribution over ``sub_ids`` followed by the reject classes (any number)."""
    p = np.asarray(p, dtype=np.float64)
    n = len(sub_ids)
    p_sub = p[:n]
    p_not = float(p[n:].sum())
    cats = list(dict.fromkeys(sub_categories))
    cat_arr = np.array(sub_categories)
    p_cat = np.array([p_sub[cat_arr == c].sum() for c in cats])
    best_c = int(np.argmax(p_cat))
    cat_id, cat_conf = cats[best_c], float(p_cat[best_c])
    cat_alts = _alternatives(cats, p_cat, cat_id)
    category = (
        _field(cat_id, cat_conf, cat_alts)
        if cat_conf >= th.category and p_not < th.not_garment
        else None
    )
    subcategory = None
    sub_id = None
    if category is not None:
        in_cat = np.where(cat_arr == cat_id)[0]
        j = int(in_cat[np.argmax(p_sub[in_cat])])
        sub_conf = float(p_sub[j])
        if sub_conf >= th.subcategory:
            sub_id = sub_ids[j]
            subcategory = _field(
                sub_id, sub_conf, _alternatives(sub_ids, p_sub, sub_id)
            )
    total = p_sub.sum()
    cond = p_sub / total if total > 0 else np.full_like(p_sub, 1 / len(p_sub))
    return GarmentDecision(
        category, subcategory, p_not, cond, cat_id if category else None, sub_id
    )


def decide_single(
    ids: list[str], p: np.ndarray, threshold: float
) -> dict[str, Any] | None:
    i = int(np.argmax(p))
    if float(p[i]) < threshold:
        return None
    return _field(ids[i], float(p[i]), _alternatives(ids, p, ids[i]))


def decide_materials(
    ids: list[str], p: np.ndarray, threshold: float, garment: GarmentDecision
) -> dict[str, Any] | None:
    chosen: dict[str, float] = {}
    for i, mid in enumerate(ids):
        if mid in P.VISUAL_MATERIALS and float(p[i]) >= threshold:
            chosen[mid] = float(p[i])
    if garment.subcategory is not None:
        for mid in SUBCATEGORY_MATERIALS.get(garment.subcategory["value"], ()):
            chosen[mid] = max(
                chosen.get(mid, 0.0), float(garment.subcategory["confidence"])
            )
    if not chosen:
        return None
    values = sorted(chosen, key=chosen.get, reverse=True)
    return {"value": values, "confidence": round(min(chosen.values()), 4)}


def decide_styles(
    style_ids: list[str],
    p_zero_shot: np.ndarray,
    style_prior: np.ndarray,
    garment: GarmentDecision,
    threshold: float,
) -> dict[str, Any] | None:
    """Expected vocabulary style affinity under P(sub | garment), blended with zero-shot evidence."""
    if garment.category is None:
        return None
    prior = garment.sub_probs @ style_prior  # (S,) expected affinity in [0, 1]
    zs = p_zero_shot / max(float(p_zero_shot.max()), 1e-12)
    score = STYLE_PRIOR_WEIGHT * prior + (1 - STYLE_PRIOR_WEIGHT) * zs
    order = [i for i in np.argsort(-score) if score[i] >= threshold][:MAX_STYLES]
    if not order:
        return None
    return {
        "value": [style_ids[i] for i in order],
        "confidence": round(float(min(score[i] for i in order)), 4),
    }


def decide_seasons(
    warmth_ids: list[str],
    p_warmth: np.ndarray,
    seasons: tuple[str, ...],
    threshold: float,
    garment: GarmentDecision,
) -> dict[str, Any] | None:
    if garment.category is None:
        return None
    score = {s: 0.0 for s in seasons}
    for i, wid in enumerate(warmth_ids):
        for s in P.WARMTH_SEASONS[wid]:
            score[s] += float(p_warmth[i])
    chosen = [s for s in seasons if score[s] >= threshold]
    if not chosen:
        return None
    return {"value": chosen, "confidence": round(min(score[s] for s in chosen), 4)}


def decide_fit(
    fit_ids: list[str],
    p_fit: np.ndarray,
    threshold: float,
    garment: GarmentDecision,
    *,
    worn: bool = True,
) -> dict[str, Any] | None:
    """Fit is only judged on a garment that is being worn: flat or hanging, size relative to a
    body is unknowable, so we abstain."""
    if (
        not worn
        or garment.category is None
        or garment.category["value"] not in FIT_CATEGORIES
    ):
        return None
    return decide_single(fit_ids, p_fit, threshold)


def classify_embeddings(
    heads: ZeroShotHeads, embeddings: np.ndarray, th: Thresholds, *, worn: bool = False
) -> list[dict[str, Any]]:
    """Run every head on a batch of item embeddings and apply the decision rules."""
    if embeddings.shape[0] == 0:
        return []
    vocab = heads.vocab
    sub_ids = [s.id for s in vocab.subcategories]
    sub_cats = [s.category for s in vocab.subcategories]
    pg = heads.garment.probs(embeddings)
    pp = heads.pattern.probs(embeddings)
    pm = heads.material.probs(embeddings)
    ps = heads.style.probs(embeddings)
    pw = heads.warmth.probs(embeddings)
    pf = heads.fit.probs(embeddings)
    out = []
    for i in range(embeddings.shape[0]):
        g = decide_garment(pg[i], sub_ids, sub_cats, th)
        pattern = (
            decide_single(heads.pattern.ids, pp[i], th.pattern) if g.category else None
        )
        out.append(
            {
                "category": g.category,
                "subcategory": g.subcategory,
                "pattern": pattern,
                "materials": decide_materials(heads.material.ids, pm[i], th.material, g)
                if g.category
                else None,
                "styles": decide_styles(
                    heads.style.ids, ps[i], heads.style_prior, g, th.style
                ),
                "seasons": decide_seasons(
                    heads.warmth.ids, pw[i], vocab.seasons, th.season, g
                ),
                "fit": decide_fit(heads.fit.ids, pf[i], th.fit, g, worn=worn),
                "_not_garment": g.not_garment,
            }
        )
    return out
