"""Exact (SHA-256) and perceptual (64-bit DCT pHash) image fingerprints.

The pHash follows the classic Zauner / ``imagehash.phash`` recipe (not checked
bit-for-bit against that library): greyscale → 32×32 (Lanczos) → 2-D DCT-II → top-left
8×8 block (including DC) → bit = coefficient > median. Bits are packed row-major,
MSB first, into 16 lowercase hex chars. Compare with Hamming distance. Measured on
the 58 eval photos: resize 50 % + JPEG q60 → ≤ 2; 3 % crop per side → median 8,
max 16; different photos → min 18, median 32. Suggested: ≤ 6 same photo,
7–16 possibly an edited/cropped copy (confirm with the embedding), ≥ 18 unrelated.
"""

from __future__ import annotations

import hashlib

import numpy as np
from PIL import Image
from scipy.fft import dct


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def phash(image: Image.Image, hash_size: int = 8, highfreq_factor: int = 4) -> str:
    size = hash_size * highfreq_factor
    grey = image.convert("L").resize((size, size), Image.Resampling.LANCZOS)
    pixels = np.asarray(grey, dtype=np.float64)
    coeffs = dct(dct(pixels, axis=0), axis=1)
    low = coeffs[:hash_size, :hash_size]
    bits = (low > np.median(low)).flatten()
    value = 0
    for bit in bits:
        value = (value << 1) | int(bit)
    return f"{value:0{hash_size * hash_size // 4}x}"


def hamming_distance(hash_a: str, hash_b: str) -> int:
    return int(bin(int(hash_a, 16) ^ int(hash_b, 16)).count("1"))
