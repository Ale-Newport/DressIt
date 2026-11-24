"""Colour science: parity with packages/shared/src/colors.ts and dominant-colour extraction."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest

from app.colors import (
    delta_e2000,
    extract_colors,
    hex_to_lab,
    hex_to_rgb,
    lab_to_rgb,
    nearest_color_family,
    rgb_to_hex,
    rgb_to_lab,
)

FIXTURE = Path(__file__).parent / "fixtures" / "colors_ts_parity.json"

# Sharma, Wu & Dalal (2005) Table 1 — same pairs as packages/shared/test/colors.test.ts
SHARMA = [
    ([50, 2.6772, -79.7751], [50, 0, -82.7485], 2.0425),
    ([50, 3.1571, -77.2803], [50, 0, -82.7485], 2.8615),
    ([50, 2.8361, -74.02], [50, 0, -82.7485], 3.4412),
    ([50, -1.3802, -84.2814], [50, 0, -82.7485], 1.0),
    ([50, 0, 0], [50, -1, 2], 2.3669),
    ([50, 2.49, -0.001], [50, -2.49, 0.0009], 7.1792),
    ([60.2574, -34.0099, 36.2677], [60.4626, -34.1751, 39.4387], 1.2644),
    ([22.7233, 20.0904, -46.694], [23.0331, 14.973, -42.5619], 2.0373),
    ([90.9257, -0.5406, -0.9208], [88.6381, -0.8985, -0.7239], 1.5381),
]


@pytest.mark.parametrize("a,b,expected", SHARMA)
def test_ciede2000_reference_pairs(a, b, expected):
    assert float(delta_e2000(np.array(a), np.array(b))) == pytest.approx(
        expected, abs=1e-4
    )


def test_parity_with_typescript_implementation():
    data = json.loads(FIXTURE.read_text())
    for row in data["colors"]:
        lab = hex_to_lab(row["hex"])
        np.testing.assert_allclose(lab, row["lab"], atol=1e-9, err_msg=row["hex"])
        fam, dist = nearest_color_family(row["hex"])
        assert fam == row["nearest"]["family"], row["hex"]
        assert dist == pytest.approx(row["nearest"]["distance"], abs=1e-9)
    for pair in data["pairs"]:
        de = float(delta_e2000(hex_to_lab(pair["a"]), hex_to_lab(pair["b"])))
        assert de == pytest.approx(pair["de"], abs=1e-9)


def test_family_examples_match_ts_tests():
    assert nearest_color_family("#000000")[0] == "negro"
    assert nearest_color_family("#ffffff")[0] == "blanco"
    assert nearest_color_family("#1c2541")[0] == "azul_marino"
    assert nearest_color_family("#d2b48c")[0] == "beige"
    assert nearest_color_family("#b22222")[0] == "rojo"


def test_metallic_families_are_never_assigned():
    assert nearest_color_family("#c9a64b")[0] != "dorado"
    assert nearest_color_family("#c0c2c4")[0] != "plateado"


def test_lab_roundtrip_and_white_point():
    L, a, b = hex_to_lab("#ffffff")
    assert L == pytest.approx(100, abs=0.1) and abs(a) < 0.5 and abs(b) < 0.5
    rng = np.random.default_rng(0)
    rgb = rng.integers(0, 256, size=(500, 3)).astype(np.float64)
    np.testing.assert_allclose(lab_to_rgb(rgb_to_lab(rgb)), rgb, atol=1e-6)
    assert rgb_to_hex(hex_to_rgb("#4b6584")) == "#4b6584"


def _pixels(*parts: tuple[tuple[int, int, int], int]) -> np.ndarray:
    return np.concatenate([np.tile(np.array(c, np.uint8), (n, 1)) for c, n in parts])


def test_solid_colour_gives_one_dominant_colour():
    cols = extract_colors(_pixels(((198, 40, 40), 5000)))
    assert len(cols) == 1
    assert cols[0].family == "rojo"
    assert cols[0].share == pytest.approx(1.0)
    assert cols[0].hex == "#c62828"


def test_stripes_give_two_colours_with_correct_shares():
    h, w, period = 200, 200, 20
    img = np.zeros((h, w, 3), np.uint8)
    for y in range(h):
        img[y] = (
            (31, 42, 68) if (y // (period // 2)) % 2 == 0 else (246, 246, 244)
        )  # navy / white
    cols = extract_colors(img.reshape(-1, 3))
    fams = {c.family: c.share for c in cols}
    assert set(fams) == {"azul_marino", "blanco"}
    assert fams["azul_marino"] == pytest.approx(0.5, abs=0.02)
    assert sum(c.share for c in cols) == pytest.approx(1.0)


def test_shading_of_one_fabric_is_merged():
    # Folds: the same red at several lightness levels must not become 3 colours.
    base = np.array([198, 40, 40], np.float64)
    shades = [np.clip(base * f, 0, 255).astype(np.uint8) for f in (0.8, 0.9, 1.0, 1.08)]
    px = np.concatenate([np.tile(s, (1500, 1)) for s in shades])
    cols = extract_colors(px)
    assert len(cols) == 1 and cols[0].family == "rojo"


def test_three_colours_sorted_by_share_and_capped():
    px = _pixels(((246, 246, 244), 6000), ((198, 40, 40), 3000), ((31, 42, 68), 1000))
    cols = extract_colors(px)
    assert [c.family for c in cols] == ["blanco", "rojo", "azul_marino"]
    assert [round(c.share, 1) for c in cols] == [0.6, 0.3, 0.1]
    px4 = _pixels(
        ((246, 246, 244), 4000),
        ((198, 40, 40), 3000),
        ((31, 42, 68), 2000),
        ((46, 125, 79), 1000),
    )
    assert len(extract_colors(px4)) == 3


def test_tiny_specks_are_dropped_and_extraction_is_deterministic():
    px = _pixels(((47, 94, 168), 9700), ((242, 209, 60), 300))  # 3 % yellow logo
    a, b = extract_colors(px), extract_colors(px)
    assert [c.to_dict() for c in a] == [c.to_dict() for c in b]
    assert [c.family for c in a] == ["azul"]


def test_empty_input():
    assert extract_colors(np.zeros((0, 3), np.uint8)) == []
