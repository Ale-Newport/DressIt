"""Threshold / abstention rules of the zero-shot heads (pure functions, no models)."""

from __future__ import annotations

import numpy as np
import pytest

from app import prompts as P
from app.config import Thresholds
from app.pipeline.classify import (
    decide_fit,
    decide_garment,
    decide_materials,
    decide_seasons,
    decide_single,
    decide_styles,
)
from app.vocabulary import load_vocabulary

VOCAB = load_vocabulary()
SUB_IDS = [s.id for s in VOCAB.subcategories]
SUB_CATS = [s.category for s in VOCAB.subcategories]
N_REJECT = len(P.NOT_GARMENT_PROMPTS)
TH = Thresholds()


def dist(peaks: dict[str, float], reject: float = 0.0) -> np.ndarray:
    """Distribution over subcategories + reject classes with the given peaks, rest uniform."""
    p = np.zeros(len(SUB_IDS) + N_REJECT)
    for k, v in peaks.items():
        p[SUB_IDS.index(k)] = v
    p[len(SUB_IDS):] = reject / N_REJECT
    rest = 1.0 - p.sum()
    free = [i for i in range(len(SUB_IDS)) if p[i] == 0]
    p[free] += rest / len(free)
    return p


def test_vocabulary_and_prompts_cover_every_id():
    assert set(P.SUBCATEGORY_PROMPTS) == set(SUB_IDS)
    assert set(P.PATTERN_PROMPTS) == {p.id for p in VOCAB.patterns}
    assert set(P.MATERIAL_PROMPTS) == {m.id for m in VOCAB.materials}
    assert set(P.STYLE_PROMPTS) == set(VOCAB.styles)
    assert set(P.FIT_PROMPTS) == set(VOCAB.fits)
    assert {s for seasons in P.WARMTH_SEASONS.values() for s in seasons} == set(VOCAB.seasons)


def test_uniform_distribution_abstains():
    g = decide_garment(np.full(len(SUB_IDS) + N_REJECT, 1 / (len(SUB_IDS) + N_REJECT)), SUB_IDS, SUB_CATS, TH)
    assert g.category is None and g.subcategory is None


def test_confident_prediction_is_hierarchical_and_has_alternatives():
    g = decide_garment(dist({"vaquero": 0.7, "chino": 0.1, "pantalon": 0.05}), SUB_IDS, SUB_CATS, TH)
    assert g.category["value"] == "bottom" and g.category["confidence"] >= 0.85
    assert g.subcategory["value"] == "vaquero" and g.subcategory["confidence"] == pytest.approx(0.7, abs=0.01)
    assert g.subcategory["alternatives"][0]["value"] == "chino"
    assert all(a["value"] != "vaquero" for a in g.subcategory["alternatives"])


def test_category_without_confident_subcategory():
    # Mass spread over several tops: category is sure, subcategory is not.
    g = decide_garment(dist({"camiseta": 0.25, "polo": 0.25, "camisa": 0.25, "blusa": 0.2}), SUB_IDS, SUB_CATS, TH)
    assert g.category["value"] == "top" and g.subcategory is None


def test_not_garment_mass_blocks_category():
    g = decide_garment(dist({"camiseta": 0.4}, reject=0.55), SUB_IDS, SUB_CATS, TH)
    assert g.category is None and g.not_garment == pytest.approx(0.55)


def test_single_label_threshold():
    ids = ["liso", "rayas", "cuadros"]
    assert decide_single(ids, np.array([0.8, 0.15, 0.05]), 0.55)["value"] == "liso"
    assert decide_single(ids, np.array([0.5, 0.3, 0.2]), 0.55) is None


def test_materials_only_visual_or_definitional():
    ids = [m.id for m in VOCAB.materials]
    p = np.full(len(ids), 0.01)
    p[ids.index("algodon")] = 0.9  # cotton is not visually identifiable → never emitted
    g_none = decide_garment(dist({"camiseta": 0.8}), SUB_IDS, SUB_CATS, TH)
    assert decide_materials(ids, p, TH.material, g_none) is None
    g_jeans = decide_garment(dist({"vaquero": 0.8}), SUB_IDS, SUB_CATS, TH)
    m = decide_materials(ids, p, TH.material, g_jeans)
    assert m == {"value": ["denim"], "confidence": pytest.approx(0.8, abs=0.01)}
    p2 = np.full(len(ids), 0.01)
    p2[ids.index("cuero")] = 0.7
    assert decide_materials(ids, p2, TH.material, g_none)["value"] == ["cuero"]


def test_seasons_follow_warmth_and_need_a_category():
    warm = ["light", "mid", "heavy"]
    g = decide_garment(dist({"plumifero": 0.8}), SUB_IDS, SUB_CATS, TH)
    assert decide_seasons(warm, np.array([0.05, 0.15, 0.8]), VOCAB.seasons, TH.season, g)["value"] == ["otono", "invierno"]
    assert decide_seasons(warm, np.array([0.7, 0.25, 0.05]), VOCAB.seasons, TH.season, g)["value"] == ["primavera", "verano"]
    g_none = decide_garment(np.full(len(SUB_IDS) + N_REJECT, 1 / (len(SUB_IDS) + N_REJECT)), SUB_IDS, SUB_CATS, TH)
    assert decide_seasons(warm, np.array([0.05, 0.15, 0.8]), VOCAB.seasons, TH.season, g_none) is None


def test_fit_only_for_apparel():
    fits = list(VOCAB.fits)
    p = np.array([0.05, 0.05, 0.1, 0.8])
    shoe = decide_garment(dist({"zapatillas": 0.8}), SUB_IDS, SUB_CATS, TH)
    top = decide_garment(dist({"sudadera": 0.8}), SUB_IDS, SUB_CATS, TH)
    assert decide_fit(fits, p, TH.fit, shoe) is None
    assert decide_fit(fits, p, TH.fit, top)["value"] == "oversize"


def test_styles_use_vocabulary_affinities():
    style_prior = np.array([[s.styles.get(st, 0.0) for st in VOCAB.styles] for s in VOCAB.subcategories])
    g = decide_garment(dist({"americana": 0.9}), SUB_IDS, SUB_CATS, TH)
    zs = np.full(len(VOCAB.styles), 1 / len(VOCAB.styles))
    out = decide_styles(list(VOCAB.styles), zs, style_prior, g, TH.style)
    blazer = VOCAB.subcategory("americana").styles
    top = {k for k, v in blazer.items() if v == max(blazer.values())}  # formal / elegante / clásico
    assert out is not None and set(out["value"]) == top
    assert "minimalista" not in out["value"] and len(out["value"]) <= 3


def test_spanish_query_translation():
    assert P.translate_query("chaqueta beige") == "beige jacket"
    assert P.translate_query("Vaqueros azul claro") == "light blue jeans"
    assert P.translate_query("camiseta a rayas azul marino") == "navy blue striped t-shirt"
    assert P.translate_query("botines de ante") == "suede ankle boots"
    assert P.translate_query("red dress") == "red dress"  # English passes through
