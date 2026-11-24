"""Detail fidelity comparator (synthetic garments; thresholds calibrated on real generations)."""

import numpy as np
from PIL import Image, ImageDraw

from app.pipeline.compare import compare_cutouts


def garment(seed: int = 0, color=(150, 110, 80), button=(30, 30, 30)) -> Image.Image:
    rng = np.random.default_rng(seed)
    h, w = 400, 320
    rgb = np.zeros((h, w, 3), np.float32) + np.array(color, np.float32)
    rgb += rng.normal(0, 18, (h, w, 1))  # knit-like texture
    img = Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8)).convert("RGBA")
    mask = Image.new("L", (w, h), 0)
    d = ImageDraw.Draw(mask)
    d.polygon(
        [
            (60, 20),
            (260, 20),
            (310, 140),
            (260, 160),
            (250, 390),
            (70, 390),
            (60, 160),
            (10, 140),
        ],
        fill=255,
    )
    img.putalpha(mask)
    ImageDraw.Draw(img).ellipse((145, 170, 175, 200), fill=(*button, 255))
    return img


def test_identical_and_rescaled_pass():
    ref = garment()
    assert compare_cutouts(ref, ref).passed
    assert compare_cutouts(ref, ref.resize((240, 300))).passed


def test_recoloured_button_is_caught():
    f = compare_cutouts(garment(), garment(button=(220, 220, 225)))
    assert not f.passed and any("zona" in r for r in f.reasons), f


def test_colour_shift_is_caught():
    f = compare_cutouts(garment(), garment(color=(190, 150, 60)))
    assert not f.passed and any("color" in r for r in f.reasons), f


def test_changed_texture_is_caught():
    f = compare_cutouts(garment(seed=0), garment(seed=1))
    assert not f.passed and any("textura" in r for r in f.reasons), f


def test_changed_shape_is_caught():
    ref = garment()
    other = ref.copy()
    a = np.asarray(other.getchannel("A")).copy()
    a[:, 230:] = 0  # one sleeve gone
    other.putalpha(Image.fromarray(a))
    f = compare_cutouts(ref, other)
    assert not f.passed and any("forma" in r for r in f.reasons), f
