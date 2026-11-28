"""Blur / brightness heuristics and Spanish warnings."""

from __future__ import annotations

import cv2
import numpy as np

from app.quality import (
    WARN_BLUR,
    WARN_DARK,
    assess_quality,
    blur_score,
    estimate_blur_sigma,
)


def _shapes() -> np.ndarray:
    img = np.full((600, 500), 230, np.uint8)
    cv2.rectangle(img, (100, 100), (400, 500), 60, -1)
    cv2.circle(img, (250, 250), 80, 180, -1)
    return img


def test_blur_estimate_tracks_gaussian_sigma():
    sharp = estimate_blur_sigma(_shapes())
    soft = estimate_blur_sigma(cv2.GaussianBlur(_shapes(), (0, 0), 4))
    assert sharp < 1.2 < 2.6 < soft
    assert blur_score(sharp) == 0.0 and blur_score(soft) > 0.5


def test_blur_estimate_is_contrast_invariant_and_noise_tolerant():
    low = (_shapes().astype(np.float32) * 0.3 + 120).astype(np.uint8)
    noisy = np.clip(
        cv2.GaussianBlur(_shapes(), (0, 0), 1.0)
        + np.random.default_rng(0).normal(0, 3, (600, 500)),
        0,
        255,
    ).astype(np.uint8)
    assert blur_score(estimate_blur_sigma(low)) < 0.2
    assert blur_score(estimate_blur_sigma(noisy)) < 0.3


def test_flat_crop_is_not_flagged():
    assert estimate_blur_sigma(np.full((300, 300), 200, np.uint8)) == 0.0


def _rgb(gray: np.ndarray) -> np.ndarray:
    return np.dstack([gray] * 3)


def test_warnings_in_spanish():
    mask = np.ones((600, 500), bool)
    blurred = assess_quality(
        _rgb(cv2.GaussianBlur(_shapes(), (0, 0), 5)),
        mask,
        source_long_side_px=1200,
        mask_area_ratio=0.3,
        touches_border=False,
        mask_suspicious=False,
    )
    assert WARN_BLUR in blurred.warnings
    dark = assess_quality(
        _rgb((_shapes() * 0.15).astype(np.uint8)),
        mask,
        source_long_side_px=1200,
        mask_area_ratio=0.3,
        touches_border=False,
        mask_suspicious=False,
    )
    assert WARN_DARK in dark.warnings and dark.brightness < 0.22
    ok = assess_quality(
        _rgb(_shapes()),
        mask,
        source_long_side_px=1200,
        mask_area_ratio=0.3,
        touches_border=False,
        mask_suspicious=False,
    )
    assert ok.warnings == [] and 0 <= ok.blur <= 1 and 0 <= ok.brightness <= 1
