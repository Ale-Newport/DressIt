"""Catalogue photo checks: presentation (is it a product photo?) and pose-invariant fidelity.

Synthetic garments only; the thresholds were calibrated on real generations and negative controls
(docs/evidence/foto-catalogo-2026-11-24.md).
"""

import io

import numpy as np
from PIL import Image, ImageDraw

from app.pipeline.catalog_check import (
    CatalogLimits,
    background_stats,
    chi2,
    components,
    judge_fidelity,
    judge_presentation,
    palette,
    palette_distance,
    shift_lightness,
    text_match,
    texture_hist,
    unmatched,
)
from app.pipeline.masks import upright_angle

from .conftest import png_bytes

L = CatalogLimits()
NEAT = {"packshot": 0.8, "messy": 0.15, "worn": 0.05}


def tee_mask(w=400, h=500, folded_sleeve=False, tilt=0.0) -> np.ndarray:
    """A T-shirt silhouette; optionally one sleeve folded in (an untidy home photo)."""
    m = Image.new("L", (w, h), 0)
    d = ImageDraw.Draw(m)
    d.rectangle((120, 80, 280, 440), fill=255)  # body
    d.polygon([(120, 80), (40, 170), (80, 210), (120, 150)], fill=255)  # left sleeve
    if not folded_sleeve:
        d.polygon([(280, 80), (360, 170), (320, 210), (280, 150)], fill=255)
    if tilt:
        m = m.rotate(tilt, resample=Image.Resampling.NEAREST)
    return np.asarray(m) > 127


def on_background(
    mask: np.ndarray, garment=(40, 60, 120), bg=(255, 255, 255), noise=0.0
) -> np.ndarray:
    rgb = np.zeros((*mask.shape, 3), np.float32) + np.array(bg, np.float32)
    if noise:
        rgb += np.random.default_rng(0).normal(0, noise, rgb.shape)
    rgb[mask] = garment
    return np.clip(rgb, 0, 255).astype(np.uint8)


def cutout(
    mask: np.ndarray, color=(40, 60, 120), texture_seed: int | None = None
) -> Image.Image:
    rgb = np.zeros((*mask.shape, 3), np.float32) + np.array(color, np.float32)
    if texture_seed is not None:
        rgb += np.random.default_rng(texture_seed).normal(0, 14, (*mask.shape, 1))
    a = (mask * 255).astype(np.uint8)
    return Image.fromarray(
        np.dstack([np.clip(rgb, 0, 255).astype(np.uint8), a]), "RGBA"
    )


def present(rgb, mask, category="top", probs=NEAT):
    return judge_presentation(
        rgb, mask, (mask * 255).astype(np.uint8), category, probs, L
    )


def test_a_neat_symmetric_packshot_passes():
    m = tee_mask()
    p = present(on_background(m), m)
    assert p.passed, p
    assert p.symmetry and p.symmetry > 0.9
    assert p.background_l > 95 and p.components == 1


def test_background_removal_alone_is_not_a_packshot():
    # Same garment, sleeve still folded in: the background is perfect but the arrangement is not.
    m = tee_mask(folded_sleeve=True)
    p = present(on_background(m), m, probs={"packshot": 0.3, "messy": 0.6, "worn": 0.1})
    assert not p.passed
    assert "asymmetric" in p.codes and "messy" in p.codes


def test_tilted_garment_is_caught():
    m = tee_mask(tilt=12)
    p = present(on_background(m), m)
    assert "tilted" in p.codes or "asymmetric" in p.codes
    angle, _, _ = upright_angle(m)
    assert abs(angle) > 5


def test_cluttered_background_cropped_and_worn_are_caught():
    m = tee_mask()
    bed = on_background(m, bg=(120, 90, 160), noise=30)
    assert "background" in present(bed, m).codes
    cut = np.zeros_like(m)
    cut[:, :] = m
    cut[:, :60] = True  # garment running off the left edge
    assert "cropped" in present(on_background(cut), cut).codes
    worn = present(
        on_background(m), m, probs={"packshot": 0.2, "messy": 0.1, "worn": 0.7}
    )
    assert "worn" in worn.codes


def test_shoes_need_no_symmetry_and_may_be_a_pair():
    m = np.zeros((400, 500), bool)
    m[200:300, 40:220] = True
    m[200:300, 280:460] = True
    p = present(on_background(m), m, category="footwear")
    assert p.symmetry is None and p.components == 2 and p.passed, p
    assert "multiple" in present(on_background(m), m, category="top").codes


def test_background_stats_and_components():
    white = np.full((100, 100, 3), 255, np.uint8)
    light, std, chroma = background_stats(white)
    assert light > 99 and std < 0.5 and chroma < 1
    two = np.zeros((50, 50), bool)
    two[5:20, 5:20] = True
    two[30:45, 30:45] = True
    two[0, 49] = True  # a speck does not count
    assert components(two) == 2


def fid(ref: Image.Image, cand: Image.Image, **over):
    kw = dict(
        similarity=0.9,
        category="top",
        expected_category="top",
        subcategory="camiseta",
        pattern="liso",
        reference_pattern="liso",
        ref_palette=palette(ref),
        cand_palette=palette(cand),
        lightness_shift=0.0,
        texture=chi2(texture_hist(ref), texture_hist(cand)),
        ref_text=[],
        cand_text=[],
        limits=L,
    )
    kw.update(over)
    return judge_fidelity(**kw)


def test_fidelity_ignores_the_arrangement():
    # The packshot re-arranges the garment: a different silhouette with the same fabric passes.
    ref = cutout(tee_mask(folded_sleeve=True), texture_seed=1)
    cand = cutout(tee_mask(), texture_seed=2)
    f = fid(ref, cand)
    assert f.passed, f


def test_fidelity_catches_colour_type_and_text_changes():
    ref = cutout(tee_mask(), color=(40, 60, 120), texture_seed=1)
    red = cutout(tee_mask(), color=(170, 40, 40), texture_seed=1)
    assert "color" in fid(ref, red).codes
    assert "type" in fid(ref, ref, category="bottom").codes
    assert "different" in fid(ref, ref, similarity=0.5).codes
    assert "pattern" in fid(ref, ref, pattern="rayas").codes
    assert (
        "pattern" not in fid(ref, ref, pattern="grafico").codes
    )  # a logo is not a pattern change
    assert "text" in fid(ref, ref, ref_text=["VACCINATED"], cand_text=["COVID"]).codes
    assert fid(ref, ref, ref_text=["VACCINATED"], cand_text=["VACCINATEO"]).passed


def test_studio_light_may_change_lightness_but_not_black_to_white():
    dark = palette(
        cutout(tee_mask(), color=(95, 92, 98))
    )  # a black polo photographed grey
    black = palette(cutout(tee_mask(), color=(25, 25, 27)))
    shift = -38.0
    assert palette_distance(shift_lightness(dark, shift), black) < L.max_palette_emd
    assert not unmatched(
        shift_lightness(dark, shift), black, 0.15, L.max_missing_delta_e
    )
    white = cutout(tee_mask(), color=(245, 245, 245))
    f = fid(cutout(tee_mask(), color=(25, 25, 27)), white, lightness_shift=88.0)
    assert "lightness" in f.codes or "color" in f.codes


def test_texture_and_text_helpers():
    a = cutout(tee_mask(), texture_seed=3)
    assert chi2(texture_hist(a), texture_hist(a)) < 1e-9
    flat = cutout(tee_mask())
    assert chi2(texture_hist(a), texture_hist(flat)) > 0.1
    assert text_match([], ["X"]) is None
    assert text_match(["ZARA", "BASIC"], ["ZARA"]) == 0.5


def test_endpoint_contract(client):
    m = tee_mask()
    ref = cutout(m)
    buf = io.BytesIO()
    ref.save(buf, "PNG")
    r = client.post(
        "/v1/catalog/check",
        files={
            "reference": ("r.png", buf.getvalue(), "image/png"),
            "candidate": ("c.png", png_bytes(on_background(m)), "image/png"),
        },
        data={"kind": "generated", "category": "top", "subcategory": "camiseta"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert set(body) == {"presentation", "fidelity", "bbox", "cutout_png_base64"}
    assert {"symmetry", "neat", "codes", "passed"} <= set(body["presentation"])
    assert {"similarity", "palette_emd", "lightness_shift", "codes", "passed"} <= set(
        body["fidelity"]
    )
    bad = client.post(
        "/v1/catalog/check",
        files={
            "reference": ("r.png", buf.getvalue(), "image/png"),
            "candidate": ("c.png", png_bytes(on_background(m)), "image/png"),
        },
        data={"kind": "nope"},
    )
    assert bad.status_code == 422


def test_glare_is_not_a_colour_but_white_stripes_are():
    m = tee_mask()
    base = cutout(m, color=(50, 80, 160), texture_seed=1)
    sunlit = np.asarray(base).copy()
    ys, xs = np.nonzero(m)
    glare = (
        np.random.default_rng(3).random(ys.size) < 0.09
    )  # specular highlights on glossy nylon
    sunlit[ys[glare], xs[glare], :3] = (236, 240, 248)
    f = fid(Image.fromarray(sunlit, "RGBA"), base)
    assert f.passed, f
    striped = np.asarray(base).copy()
    stripes = (ys // 20) % 3 == 0  # a third of the garment: real white stripes
    striped[ys[stripes], xs[stripes], :3] = (240, 240, 240)
    assert "color" in fid(Image.fromarray(striped, "RGBA"), base).codes


def test_a_packshot_dressed_as_an_outfit_is_caught(monkeypatch):
    """Polo + invented trousers: one silhouette for the single-item analysis, two for the detector."""
    from app.pipeline import catalog_check as cc

    def fake_multi(*_a, **_k):
        return {
            "items": [
                {
                    "category": {"value": "top"},
                    "subcategory": {"value": "polo"},
                    "bbox": [0.2, 0.05, 0.8, 0.45],
                },
                {
                    "category": {"value": "bottom"},
                    "subcategory": {"value": "pantalon_vestir"},
                    "bbox": [0.3, 0.45, 0.7, 0.98],
                },
                {
                    "category": {"value": "accessory"},
                    "subcategory": {"value": "cinturon"},
                    "bbox": [0.3, 0.44, 0.7, 0.5],
                },
            ]
        }

    monkeypatch.setattr(cc, "analyze_image", fake_multi)
    assert cc.added_garments(b"", "top", None, None) == ["pantalon_vestir"]  # type: ignore[arg-type]
    assert cc.added_garments(b"", "bottom", None, None) == ["polo"]  # type: ignore[arg-type]
    # Accessories (a belt in jeans) and the garment's own category never count.
    monkeypatch.setattr(
        cc,
        "analyze_image",
        lambda *_a, **_k: {
            "items": [fake_multi()["items"][2], fake_multi()["items"][1]]
        },
    )
    assert cc.added_garments(b"", "bottom", None, None) == []  # type: ignore[arg-type]
