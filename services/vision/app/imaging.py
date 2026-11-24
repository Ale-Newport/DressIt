"""Image decoding, orientation, gentle auto-crop, cutout normalisation and encoding."""

from __future__ import annotations

import base64
import io
from dataclasses import dataclass

import numpy as np
from PIL import Image, ImageOps, UnidentifiedImageError

from .colors import rgb_to_lab, srgb_to_linear, linear_to_srgb

try:  # HEIC/HEIF (iPhone photos)
    from pillow_heif import register_heif_opener

    register_heif_opener()
    HEIF_AVAILABLE = True
except Exception:  # pragma: no cover - optional dependency
    HEIF_AVAILABLE = False

Image.MAX_IMAGE_PIXELS = 80_000_000  # decompression-bomb guard (~80 MP)
ALLOWED_FORMATS = {"JPEG", "PNG", "MPO", "WEBP"} | ({"HEIF", "HEIC", "AVIF"} if HEIF_AVAILABLE else set())


class ImageDecodeError(ValueError):
    """Raised for unreadable or unsupported images (mapped to HTTP 415/400)."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass
class DecodedImage:
    rgb: Image.Image  # EXIF-transposed, RGB
    alpha: np.ndarray | None  # uint8 alpha of the original if it carried real transparency
    exif_transposed: bool
    format: str


def decode_image(data: bytes) -> DecodedImage:
    try:
        img = Image.open(io.BytesIO(data))
        fmt = (img.format or "").upper()
        img.load()
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as exc:
        raise ImageDecodeError("unsupported_image", "No se ha podido leer la imagen (formatos: JPEG, PNG, HEIC).") from exc
    if fmt not in ALLOWED_FORMATS:
        raise ImageDecodeError("unsupported_image", f"Formato de imagen no admitido: {fmt or 'desconocido'}.")
    orientation = 1
    try:
        orientation = int(img.getexif().get(0x0112, 1) or 1)
    except Exception:
        orientation = 1
    img = ImageOps.exif_transpose(img) or img
    alpha: np.ndarray | None = None
    if img.mode in ("RGBA", "LA", "PA") or (img.mode == "P" and "transparency" in img.info):
        rgba = img.convert("RGBA")
        a = np.asarray(rgba)[:, :, 3]
        # Only trust alpha that really separates something (an existing cutout).
        if 0.02 < float(np.mean(a < 128)) < 0.98:
            alpha = a.copy()
        rgb = Image.alpha_composite(Image.new("RGBA", rgba.size, (255, 255, 255, 255)), rgba).convert("RGB")
    else:
        rgb = img.convert("RGB")
    return DecodedImage(rgb=rgb, alpha=alpha, exif_transposed=orientation != 1, format=fmt)


def resize_max_side(img: Image.Image, max_side: int) -> tuple[Image.Image, float]:
    """Downscale so the longest side ≤ ``max_side``. Returns the image and the scale applied."""
    w, h = img.size
    scale = min(1.0, max_side / max(w, h))
    if scale >= 1.0:
        return img, 1.0
    return img.resize((max(1, round(w * scale)), max(1, round(h * scale))), Image.Resampling.LANCZOS), scale


def content_box(rgb: np.ndarray, *, delta_e: float = 6.0, margin: float = 0.03, min_trim: float = 0.04) -> tuple[int, int, int, int]:
    """Gentle auto-crop: trims only uniform borders (scan margins, letterboxing, studio sweep).

    The border colour is the median of the outer 2 % frame; rows/columns whose
    pixels are all within ``delta_e`` (ΔE76, cheap) of it are trimmed. The crop is
    applied only when it removes ≥ ``min_trim`` of the area and keeps a
    ``margin`` around the content. Returns ``(x0, y0, x1, y1)`` in pixels.
    """
    h, w = rgb.shape[:2]
    full = (0, 0, w, h)
    if h < 32 or w < 32:
        return full
    small_scale = min(1.0, 256 / max(h, w))
    step = max(1, int(round(1 / small_scale)))
    sub = rgb[::step, ::step]
    lab = rgb_to_lab(sub.astype(np.float64))
    sh, sw = lab.shape[:2]
    fw = max(1, int(round(min(sh, sw) * 0.02)))
    frame = np.concatenate([
        lab[:fw].reshape(-1, 3), lab[-fw:].reshape(-1, 3), lab[:, :fw].reshape(-1, 3), lab[:, -fw:].reshape(-1, 3)
    ])
    border = np.median(frame, axis=0)
    spread = np.percentile(np.linalg.norm(frame - border, axis=1), 90)
    if spread > delta_e:  # border is not uniform → nothing to trim
        return full
    diff = np.linalg.norm(lab - border, axis=2) > delta_e
    rows = np.where(diff.mean(axis=1) > 0.01)[0]
    cols = np.where(diff.mean(axis=0) > 0.01)[0]
    if rows.size == 0 or cols.size == 0:
        return full
    y0, y1 = rows[0] * step, min(h, (rows[-1] + 1) * step)
    x0, x1 = cols[0] * step, min(w, (cols[-1] + 1) * step)
    mx, my = int((x1 - x0) * margin), int((y1 - y0) * margin)
    box = (max(0, x0 - mx), max(0, y0 - my), min(w, x1 + mx), min(h, y1 + my))
    kept = (box[2] - box[0]) * (box[3] - box[1]) / float(w * h)
    if kept > 1 - min_trim or kept < 0.05:
        return full
    return box


def normalize_cutout_colors(rgb: np.ndarray, garment_mask: np.ndarray) -> tuple[np.ndarray, dict[str, float]]:
    """Mild white-balance + exposure normalisation (documented in docs/vision.md).

    * White balance: von Kries gains in linear RGB estimated from *background*
      pixels, applied only if the background is near-neutral (it is probably a
      wall/sheet/table under a colour cast) and clamped to ±6 % per channel, so a
      garment hue cannot move materially (tests assert < 3° hue shift).
    * Exposure: a single gain on all channels (hue/chroma ratios preserved)
      if the scene is clearly underexposed (p98 luminance < 0.7), capped at ×1.3.
    Returns the corrected image and the applied gains (all 1.0 = untouched).
    """
    info = {"wb_r": 1.0, "wb_g": 1.0, "wb_b": 1.0, "exposure": 1.0}
    bg = ~garment_mask
    if bg.sum() < 0.05 * garment_mask.size or garment_mask.sum() < 64:
        return rgb, info
    lin = srgb_to_linear(rgb)
    bg_lin = lin[bg]
    bg_lab = rgb_to_lab(rgb[bg][:: max(1, int(bg.sum() // 20000))].astype(np.float64))
    bg_chroma = float(np.median(np.hypot(bg_lab[:, 1], bg_lab[:, 2])))
    bg_l = float(np.median(bg_lab[:, 0]))
    gains = np.ones(3)
    if 4.0 < bg_chroma < 14.0 and bg_l > 35:  # neutral-ish surface with a mild cast
        means = np.median(bg_lin, axis=0)
        grey = float(np.mean(means))
        gains = np.clip(grey / np.maximum(means, 1e-6), 0.94, 1.06)
    y = lin @ np.array([0.2126729, 0.7151522, 0.072175])
    p98 = float(np.percentile(y, 98))
    exposure = 1.0
    if p98 < 0.7:
        exposure = float(min(1.3, 0.8 / max(p98, 1e-3)))
    if np.allclose(gains, 1.0) and exposure == 1.0:
        return rgb, info
    out = linear_to_srgb(lin * gains * exposure)
    info.update(wb_r=float(gains[0]), wb_g=float(gains[1]), wb_b=float(gains[2]), exposure=exposure)
    return out.round().astype(np.uint8), info


def pad_to_square(img: Image.Image, fill: tuple[int, int, int] = (255, 255, 255)) -> Image.Image:
    w, h = img.size
    side = max(w, h)
    canvas = Image.new("RGB", (side, side), fill)
    canvas.paste(img, ((side - w) // 2, (side - h) // 2))
    return canvas


def composite_on_white(rgba: Image.Image) -> Image.Image:
    base = Image.new("RGBA", rgba.size, (255, 255, 255, 255))
    return Image.alpha_composite(base, rgba.convert("RGBA")).convert("RGB")


def encode_png_base64(img: Image.Image) -> str:
    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=False, compress_level=6)
    return base64.b64encode(buf.getvalue()).decode("ascii")
