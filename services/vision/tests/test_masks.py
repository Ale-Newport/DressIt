"""Cutout-refinement mask logic on synthetic arrays (no models)."""

from __future__ import annotations

import numpy as np

from app.models.base import Detection
from app.pipeline.analyze import Candidate, _layer
from app.pipeline.masks import decontaminate_edges, region_view, support_removal, thin_border_structures
from app.pipeline.refine import promote_head_forms, rank_proposals


def _box(shape, y0, y1, x0, x1):
    m = np.zeros(shape, bool)
    m[y0:y1, x0:x1] = True
    return m


# ------------------------------------------------------------ support removal
def test_support_removed_garment_kept():
    shape = (200, 200)
    garment = _box(shape, 60, 190, 40, 160)
    hook = _box(shape, 10, 62, 95, 105)  # hanger hook touching the garment's top edge
    fg = garment | hook
    remove = support_removal(fg, [garment, hook], np.array([0.01, 0.9]), min_prob=0.5, max_area=0.6)
    assert remove[20, 100] and remove[40, 100]
    # The garment pixels the hook region overlaps (rows 60–61) stay: the garment is the core.
    assert not remove[61, 100]
    assert not (remove & garment).any()


def test_low_probability_or_large_region_is_not_removed():
    shape = (100, 100)
    fg = _box(shape, 10, 90, 10, 90)
    part = _box(shape, 10, 30, 10, 90)
    assert not support_removal(fg, [part], np.array([0.4]), min_prob=0.5, max_area=0.6).any()
    big = _box(shape, 10, 80, 10, 90)  # 87 % of the foreground: never a support
    assert not support_removal(fg, [big], np.array([0.99]), min_prob=0.5, max_area=0.6).any()


def test_box_around_garment_and_support_does_not_protect_the_support():
    """A region "beanie + mannequin head" (recognised as a beanie) must not shield the head."""
    shape = (200, 120)
    hat = _box(shape, 10, 90, 20, 100)
    head = _box(shape, 90, 190, 30, 90)
    fg = hat | head
    both = hat | head
    remove = support_removal(fg, [hat, head, both], np.array([0.0, 0.8, 0.0]), min_prob=0.5, max_area=0.6)
    assert remove[150, 60] and not remove[50, 60]
    assert (remove == head).all()


def test_total_removal_guard():
    shape = (100, 100)
    fg = _box(shape, 0, 100, 0, 100)
    a = _box(shape, 0, 100, 0, 40)
    b = _box(shape, 0, 100, 40, 80)  # each 40 %, together 80 % > max_area
    assert not support_removal(fg, [a, b], np.array([0.9, 0.9]), min_prob=0.5, max_area=0.6).any()


def test_head_form_promotion_only_at_the_bottom_under_a_hat():
    shape = (200, 120)
    hat = _box(shape, 10, 90, 20, 100)
    head = _box(shape, 90, 190, 30, 90)
    logo = _box(shape, 30, 50, 40, 60)
    fg = hat | head
    p = np.array([0.0, 0.3, 0.3])
    out = promote_head_forms(fg, [hat, head, logo], p, np.array([False, True, True]), min_prob=0.25, to=0.5)
    assert out[1] == 0.5  # the head form reaches the bottom and starts below the top
    assert out[2] == 0.3  # a form-looking logo on the hat itself is not promoted
    not_form = promote_head_forms(fg, [hat, head], p[:2], np.array([False, False]), min_prob=0.25, to=0.5)
    assert not_form[1] == 0.3


# ------------------------------------------------------ thin border structures
def test_clothesline_through_frame_removed_strap_kept():
    shape = (200, 300)
    garment = _box(shape, 50, 190, 100, 200)
    line = _box(shape, 60, 63, 0, 300)  # 3 px line across the frame, through the garment
    strap = np.zeros(shape, bool)  # thin handle loop above the garment, inside the photo
    strap[20:23, 120:180] = True
    strap[20:52, 120:123] = True
    strap[20:52, 177:180] = True
    fg = garment | line | strap
    thin = thin_border_structures(fg, radius=3)
    assert thin[61, 10] and thin[61, 290]  # the line outside the garment
    assert not thin[21, 150] and not thin[40, 121]  # the strap does not reach the border
    assert not thin[120, 150]  # the garment body


def test_thin_border_structures_noop_on_thick_object():
    fg = _box((100, 100), 0, 100, 30, 70)  # thick and touching the border
    assert not thin_border_structures(fg, radius=3).any()


# ---------------------------------------------------------------- edge colour
def test_decontamination_removes_background_halo():
    h, w = 64, 64
    yy, xx = np.mgrid[0:h, 0:w]
    dist = np.hypot(yy - 32, xx - 32)
    alpha = np.clip((20.0 - dist) / 3.0 + 0.5, 0.0, 1.0)  # soft-edged disc
    red, white = np.array([200, 20, 20.0]), np.array([255, 255, 255.0])
    observed = alpha[..., None] * red + (1 - alpha[..., None]) * white  # edge pixels mixed with white
    rgb = observed.round().astype(np.uint8)
    a8 = (alpha * 255).round().astype(np.uint8)
    out = decontaminate_edges(rgb, a8)
    edge = (a8 > 20) & (a8 < 230)
    before = np.abs(rgb[edge].astype(float) - red).mean()
    after = np.abs(out[edge].astype(float) - red).mean()
    assert after < 0.5 * before
    # Opaque and transparent pixels are untouched.
    assert (out[a8 >= 250] == rgb[a8 >= 250]).all() and (out[a8 == 0] == rgb[a8 == 0]).all()


def test_region_view_is_square_on_white():
    rgb = np.zeros((100, 60, 3), np.uint8)
    mask = _box((100, 60), 10, 90, 10, 30)
    img = region_view(rgb, mask, side=64)
    assert img.size[0] == img.size[1] <= 64
    arr = np.asarray(img)
    assert (arr[0, 0] == 255).all()


# ------------------------------------------------------------- proposals
def test_rank_proposals_drops_full_frame_and_duplicates():
    dets = [
        Detection(box=(0, 0, 100, 100), score=0.9, label="jumpsuit"),
        Detection(box=(10, 10, 50, 50), score=0.5, label="hook"),
        Detection(box=(11, 10, 50, 51), score=0.4, label="clothes hanger"),
        Detection(box=(60, 60, 90, 90), score=0.3, label="hat"),
    ]
    out = rank_proposals(dets, 100, 100, max_n=5)
    assert [d.label for d in out] == ["hook", "hat"]
    assert len(rank_proposals(dets, 100, 100, max_n=1)) == 1


# ---------------------------------------------------------------- layering
def _cand(mask, cat, sub):
    c = Candidate(prob=mask.astype(np.float32), mask=mask)
    c.attrs = {"category": {"value": cat, "confidence": 0.9}, "subcategory": {"value": sub, "confidence": 0.9} if sub else None}
    return c


def test_layer_subtracts_recognised_garment_of_another_category():
    """Puffer jacket whose mask leaked over the jeans: the jeans pixels leave the jacket."""
    shape = (200, 100)
    jacket = _cand(_box(shape, 0, 180, 0, 100), "outerwear", "plumifero")
    jeans = _cand(_box(shape, 110, 200, 10, 90), "bottom", "vaquero")
    changed = _layer([jacket, jeans])
    assert changed == [jacket]
    assert not (jacket.mask & jeans.mask).any()
    assert jacket.mask[50, 50]


def test_layer_keeps_same_category_or_unrecognised():
    shape = (100, 100)
    big = _cand(_box(shape, 0, 100, 0, 100), "top", "camiseta")
    same = _cand(_box(shape, 20, 60, 20, 60), "top", "camisa")
    vague = _cand(_box(shape, 60, 90, 60, 90), "bottom", None)
    assert _layer([big, same, vague]) == []


def test_single_mode_layering_ignores_accessories():
    shape = (200, 100)
    skirt = _cand(_box(shape, 0, 200, 0, 100), "bottom", "falda")
    belt = _cand(_box(shape, 0, 20, 0, 100), "accessory", "cinturon")  # the skirt's own waistband
    assert _layer([skirt, belt], clothing_only=True) == []
    assert _layer([skirt, belt]) == [skirt]  # multi mode keeps subtracting it
