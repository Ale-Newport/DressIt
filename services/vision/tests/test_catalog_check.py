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


def test_studio_photo_on_light_grey_is_cut_out_and_judged(client):
    """kind=studio: a generated studio photo on plain light grey. The grey background passes (it is
    removed afterwards), the cutout of the whole item comes back, and a textured background still
    fails."""
    m = tee_mask()
    ref = cutout(m)
    buf = io.BytesIO()
    ref.save(buf, "PNG")

    def check(candidate: np.ndarray, kind: str = "studio") -> dict:
        r = client.post(
            "/v1/catalog/check",
            files={
                "reference": ("r.png", buf.getvalue(), "image/png"),
                "candidate": ("c.png", png_bytes(candidate), "image/png"),
            },
            data={"kind": kind, "category": "top", "subcategory": "camiseta"},
        )
        assert r.status_code == 200, r.text
        return r.json()

    grey = check(on_background(m, bg=(200, 200, 200)))
    assert "background" not in grey["presentation"]["codes"]
    assert grey["cutout_png_base64"]
    cut = Image.open(
        io.BytesIO(__import__("base64").b64decode(grey["cutout_png_base64"]))
    )
    assert cut.mode == "RGBA"
    alpha = np.asarray(cut.getchannel("A")) > 127
    assert 0.3 < alpha.mean() < 0.9  # the garment, not the whole frame
    assert grey["bbox"][0] > 0.05 and grey["bbox"][2] < 0.95
    # The same grey is not a white packshot background for the earlier kind.
    assert (
        "background"
        in check(on_background(m, bg=(200, 200, 200)), kind="generated")[
            "presentation"
        ]["codes"]
    )
    # A textured background (a bed, a rug) is never a studio background.
    assert (
        "background"
        in check(on_background(m, bg=(150, 120, 100), noise=40))["presentation"][
            "codes"
        ]
    )


def _solid(lab, mask=None):
    from app.colors import lab_to_rgb

    m = tee_mask() if mask is None else mask
    rgb = np.clip(np.round(lab_to_rgb(np.array(lab, float))), 0, 255).astype(np.uint8)
    arr = np.zeros((*m.shape, 4), np.uint8)
    arr[m] = [*rgb, 255]
    return Image.fromarray(arr, "RGBA")


def _lab_of(img):
    from app.colors import rgb_to_lab

    a = np.asarray(img)
    return rgb_to_lab(a[a[..., 3] > 200][:, :3].astype(float)).mean(axis=0)


def test_studio_colour_is_matched_to_the_real_garment():
    from app.pipeline.catalog_check import match_garment_colour

    # A cobalt puffer drawn steel blue gets its saturation back (hue moves toward the photo).
    out, info = match_garment_colour(_solid((45, 5, -25)), _solid((45, 15, -60)))
    lab = _lab_of(out)
    assert lab[2] < -45 and info["b_shift"] < -20
    # A black polo drawn grey is darkened back; its hue is left alone (neutral garment).
    out, info = match_garment_colour(_solid((55, 0, 0)), _solid((22, 1, 2)))
    assert info["gamma"] > 1.5 and _lab_of(out)[0] < 30 and info["a_shift"] == 0
    # Faded mid-blue jeans drawn near-black are lightened.
    out, info = match_garment_colour(_solid((18, 2, -12)), _solid((48, 0, -22)))
    assert info["gamma"] < 1 and _lab_of(out)[0] > 35
    # A black polo drawn black is not lightened to the grey that flash made of it in the photo.
    _, info = match_garment_colour(_solid((12, 0, 0)), _solid((40, 1, 1)))
    assert info["gamma"] == 1.0
    # Mid tones within the photo's light variation, and neutrals under warm light, are left as they are.
    same, info = match_garment_colour(_solid((60, 0, 0)), _solid((52, 6, 9)))
    assert info == {"gamma": 1.0, "a_shift": 0.0, "b_shift": 0.0}


def test_studio_cutout_ignores_specks_and_haze(client):
    """A dust speck in a corner and a faint contact shadow must not set the frame of a centred garment."""
    m = tee_mask()
    ref = cutout(m)
    buf = io.BytesIO()
    ref.save(buf, "PNG")
    rgb = on_background(m, bg=(205, 205, 205))
    rgb[2:8, 2:8] = (30, 30, 30)  # speck
    r = client.post(
        "/v1/catalog/check",
        files={
            "reference": ("r.png", buf.getvalue(), "image/png"),
            "candidate": ("c.png", png_bytes(rgb), "image/png"),
        },
        data={"kind": "studio", "category": "top", "subcategory": "camiseta"},
    )
    body = r.json()
    assert "cropped" not in body["presentation"]["codes"]
    assert body["bbox"][0] > 0.05 and body["bbox"][1] > 0.1


def test_studio_colour_fix_does_not_tint_the_neutral_parts_of_a_garment():
    """A red hoodie with a grey hood lining: correcting the red must leave the grey grey."""
    from app.colors import lab_to_rgb, rgb_to_lab
    from app.pipeline.catalog_check import match_garment_colour

    def two_tone(red, grey):
        arr = np.zeros((200, 200, 4), np.uint8)
        arr[:, :140] = [
            *np.clip(np.round(lab_to_rgb(np.array(red, float))), 0, 255).astype(
                np.uint8
            ),
            255,
        ]
        arr[:, 140:] = [
            *np.clip(np.round(lab_to_rgb(np.array(grey, float))), 0, 255).astype(
                np.uint8
            ),
            255,
        ]
        return Image.fromarray(arr, "RGBA")

    out, info = match_garment_colour(
        two_tone((50, 50, 35), (45, 0, 0)), two_tone((40, 62, 42), (40, 0, 0))
    )
    a = np.asarray(out)
    grey = rgb_to_lab(a[:, 160:, :3].reshape(-1, 3).astype(float)).mean(axis=0)
    red = rgb_to_lab(a[:, :100, :3].reshape(-1, 3).astype(float)).mean(axis=0)
    assert abs(grey[1]) < 2 and abs(grey[2]) < 2  # still neutral
    assert red[1] > 55  # the red got its saturation back


def test_partly_visible_garment_is_not_held_to_a_partial_reference(client):
    """The cutout of a worn hoodie also holds skin and the t-shirt under it: with partial=true the
    studio photo is not failed for "missing" those colours."""
    m = tee_mask()
    ref_arr = np.zeros((*m.shape, 4), np.uint8)
    ref_arr[m] = (200, 30, 40, 255)  # red garment…
    ref_arr[200:330, 150:250] = (
        225,
        180,
        160,
        255,
    )  # …with a face/skin patch in the middle of the cutout
    buf = io.BytesIO()
    Image.fromarray(ref_arr, "RGBA").save(buf, "PNG")

    def check(partial: bool) -> dict:
        r = client.post(
            "/v1/catalog/check",
            files={
                "reference": ("r.png", buf.getvalue(), "image/png"),
                "candidate": (
                    "c.png",
                    png_bytes(
                        on_background(m, garment=(200, 30, 40), bg=(215, 215, 215))
                    ),
                    "image/png",
                ),
            },
            data={"kind": "studio", "category": "top", "partial": str(partial).lower()},
        )
        assert r.status_code == 200, r.text
        return r.json()["fidelity"]

    assert "color" in check(False)["codes"]
    assert "color" not in check(True)["codes"]
