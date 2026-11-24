"""pHash stability and exact hashing."""

from __future__ import annotations

import io
import re

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

from app.hashing import hamming_distance, phash, sha256_hex


def _scene(seed: int) -> Image.Image:
    rng = np.random.default_rng(seed)
    img = Image.new("RGB", (640, 480), tuple(int(v) for v in rng.integers(0, 255, 3)))
    d = ImageDraw.Draw(img)
    for _ in range(12):
        x0, y0 = rng.integers(0, 600), rng.integers(0, 440)
        d.ellipse([x0, y0, x0 + rng.integers(40, 200), y0 + rng.integers(40, 200)], fill=tuple(int(v) for v in rng.integers(0, 255, 3)))
    return img.filter(ImageFilter.GaussianBlur(2))


def _recompress(img: Image.Image, quality: int) -> Image.Image:
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=quality)
    return Image.open(io.BytesIO(buf.getvalue())).convert("RGB")


def test_phash_format():
    h = phash(_scene(1))
    assert re.fullmatch(r"[0-9a-f]{16}", h)


def test_phash_stable_under_resize_and_recompression():
    img = _scene(1)
    ref = phash(img)
    variants = [
        img.resize((320, 240), Image.Resampling.LANCZOS),
        img.resize((1280, 960), Image.Resampling.BICUBIC),
        _recompress(img, 40),
        _recompress(img.resize((480, 360)), 60),
    ]
    for v in variants:
        assert hamming_distance(ref, phash(v)) <= 6


def test_phash_different_images_are_far():
    hashes = [phash(_scene(s)) for s in range(2, 8)]
    ref = phash(_scene(1))
    assert min(hamming_distance(ref, h) for h in hashes) >= 18


def test_sha256_and_hamming():
    assert sha256_hex(b"abc") == "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    assert hamming_distance("ffffffffffffffff", "0000000000000000") == 64
    assert hamming_distance("8fa2206d3dd333c3", "8fa2206d3dd333c3") == 0
