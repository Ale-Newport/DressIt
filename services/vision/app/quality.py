"""Per-item photo quality: blur, brightness and user-facing Spanish warnings.

``blur`` (0 = nítida … 1 = muy borrosa) estimates the Gaussian blur σ of the
item crop (resized to 512 px) with the re-blur gradient ratio, which is
contrast-invariant: plain, low-texture garments do not look "blurry" just
because they have little texture (unlike the variance of the Laplacian).

``brightness`` is the mean CIELAB L*/100 of the item crop (garment + its
surroundings, i.e. scene exposure; a black garment alone is not "poca luz").
"""

from __future__ import annotations

from dataclasses import dataclass, field

import cv2
import numpy as np

from .colors import rgb_to_lab

WARN_BLUR = "Imagen borrosa"
WARN_DARK = "Poca luz"
WARN_BRIGHT = "Imagen sobreexpuesta"
WARN_LOW_RES = "Resolución baja"
WARN_CUT = "La prenda sale cortada en el borde de la foto"
WARN_SMALL = "La prenda ocupa muy poco en la foto"
WARN_MASK = "No se ha podido separar bien la prenda del fondo"
WARN_NOT_GARMENT = "No se reconoce ninguna prenda en la imagen"
WARN_UNSURE = "Clasificación poco segura: revisa la categoría"

BLUR_WARN_AT = 0.5
DARK_WARN_AT = 0.22
LOW_RES_PX = 256


@dataclass
class Quality:
    blur: float
    brightness: float
    warnings: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, object]:
        return {"blur": round(self.blur, 3), "brightness": round(self.brightness, 3), "warnings": list(self.warnings)}


def estimate_blur_sigma(gray: np.ndarray, reblur_sigma: float = 2.0) -> float:
    """Approximate Gaussian blur σ (px, at 512 px longest side) of a uint8 greyscale crop.

    Re-blur ratio method (Zhuo & Sim, 2011): the peak gradient of an edge with
    blur σ scales as 1/σ, so re-blurring with a known σ_b gives the ratio
    r = √(σ²+σ_b²)/σ  →  σ = σ_b / √(r²−1). Peaks are robust percentiles over the
    whole crop, which makes the estimate contrast-invariant and noise-tolerant.
    Returns 0 when there are no usable edges (flat crops are never flagged).
    """
    h, w = gray.shape[:2]
    scale = 512.0 / max(h, w)
    if abs(scale - 1.0) > 1e-3:
        gray = cv2.resize(gray, (max(8, round(w * scale)), max(8, round(h * scale))), interpolation=cv2.INTER_AREA)
    g = gray.astype(np.float32)

    def grad_mag(x: np.ndarray) -> np.ndarray:
        gx = cv2.Sobel(x, cv2.CV_32F, 1, 0, ksize=3) / 8.0
        gy = cv2.Sobel(x, cv2.CV_32F, 0, 1, ksize=3) / 8.0
        return np.hypot(gx, gy)

    peak = float(np.percentile(grad_mag(g), 99.5))
    peak_reblurred = float(np.percentile(grad_mag(cv2.GaussianBlur(g, (0, 0), reblur_sigma)), 99.5))
    if peak_reblurred < 1.5:
        return 0.0
    ratio = peak / peak_reblurred
    return float(np.sqrt(reblur_sigma**2 / max(ratio**2 - 1.0, 1e-3)))


def blur_score(sigma: float) -> float:
    """σ̂ ≤ 1.2 px (≈ intrinsic Sobel blur of a sharp edge) → 0; σ̂ ≥ 4 px → 1."""
    if sigma <= 0:
        return 0.0
    return float(np.clip((sigma - 1.2) / 2.8, 0.0, 1.0))


def assess_quality(
    crop_rgb: np.ndarray,
    crop_mask: np.ndarray,
    *,
    source_long_side_px: int,
    mask_area_ratio: float,
    touches_border: bool,
    mask_suspicious: bool,
) -> Quality:
    gray = cv2.cvtColor(crop_rgb, cv2.COLOR_RGB2GRAY)
    blur = blur_score(estimate_blur_sigma(gray))
    step = max(1, int(np.sqrt(crop_rgb.shape[0] * crop_rgb.shape[1] / 40000)))
    lab = rgb_to_lab(crop_rgb[::step, ::step].astype(np.float64))
    lstar = lab[..., 0]
    brightness = float(np.clip(lstar.mean() / 100.0, 0.0, 1.0))
    warnings: list[str] = []
    if blur >= BLUR_WARN_AT:
        warnings.append(WARN_BLUR)
    if brightness < DARK_WARN_AT and float(np.percentile(lstar, 95)) < 55:
        warnings.append(WARN_DARK)
    m = crop_mask[::step, ::step]
    if m.any():
        clipped = np.all(crop_rgb[::step, ::step][m] >= 250, axis=-1).mean()
        if clipped > 0.35:
            warnings.append(WARN_BRIGHT)
    if source_long_side_px < LOW_RES_PX:
        warnings.append(WARN_LOW_RES)
    if touches_border:
        warnings.append(WARN_CUT)
    if mask_area_ratio < 0.02:
        warnings.append(WARN_SMALL)
    if mask_suspicious:
        warnings.append(WARN_MASK)
    return Quality(blur=blur, brightness=brightness, warnings=warnings)
