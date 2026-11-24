"""Detail-level fidelity between a garment's real cutout and an image derived from it.

Used to accept or reject AI-generated catalog photos: a generator may keep the overall look (the
global embedding barely moves) while changing the details that make the garment *this* garment —
button colours, the knit of one sleeve, a logo, a hem. So the comparison works locally:

1. both RGBA cutouts are trimmed and letterboxed to the same square;
2. the candidate is aligned to the reference with ECC on the alpha masks (rigid for the shape,
   affine for colour and texture);
3. shape: IoU of the aligned masks;
4. colour: CIEDE2000 between the mean Lab colour of every cell of a grid inside the garment —
   the worst cells catch a recoloured button or pocket that the global colour misses;
5. structure: SSIM of the luminance inside the garment — catches a changed knit/print/texture;
6. optional global embedding similarity (FashionSigLIP) from the caller.

All thresholds live in ``FidelityLimits``; they were calibrated on real generations (see
docs/evidence/catalogo-2026-11-24.md).
"""

from __future__ import annotations

from dataclasses import asdict, dataclass

import cv2
import numpy as np
from PIL import Image

from ..colors import delta_e2000, rgb_to_lab

SIDE = 256  # working resolution (square)
GRID = 12  # colour grid (12×12 cells over the garment's bounding square: a button fills about one cell)
MIN_CELL_COVER = 0.6  # a cell counts when ≥60 % of it is garment in both images


@dataclass(frozen=True)
class FidelityLimits:
    min_shape_iou: float = 0.82
    max_cell_delta_e: float = 12.0  # worst garment cell
    max_p90_delta_e: float = 6.0
    min_ssim: float = 0.55
    max_mean_delta_e: float = 6.0


@dataclass
class Fidelity:
    shape_iou: float
    mean_delta_e: float
    p90_delta_e: float
    max_cell_delta_e: float
    ssim: float
    cells: int
    passed: bool
    reasons: list[str]

    def to_dict(self) -> dict:
        return asdict(self)


def _letterbox(rgba: Image.Image) -> tuple[np.ndarray, np.ndarray]:
    """Trim to alpha, letterbox to SIDE×SIDE; returns (rgb uint8 HxWx3, alpha float HxW in 0–1)."""
    rgba = rgba.convert("RGBA")
    bbox = rgba.getchannel("A").point(lambda a: 255 if a > 16 else 0).getbbox()
    if bbox:
        rgba = rgba.crop(bbox)
    w, h = rgba.size
    s = (SIDE - 8) / max(w, h)
    rgba = rgba.resize(
        (max(1, round(w * s)), max(1, round(h * s))), Image.Resampling.LANCZOS
    )
    canvas = Image.new("RGBA", (SIDE, SIDE), (255, 255, 255, 0))
    canvas.paste(rgba, ((SIDE - rgba.width) // 2, (SIDE - rgba.height) // 2))
    arr = np.asarray(canvas).astype(np.float32)
    return arr[..., :3].astype(np.uint8), arr[..., 3] / 255.0


def _align(
    ref_a: np.ndarray, cand_rgb: np.ndarray, cand_a: np.ndarray, motion: int
) -> tuple[np.ndarray, np.ndarray]:
    """ECC alignment of the candidate onto the reference, driven by the (blurred) masks."""
    warp = np.eye(2, 3, dtype=np.float32)
    src = cv2.GaussianBlur(cand_a.astype(np.float32), (0, 0), 3)
    dst = cv2.GaussianBlur(ref_a.astype(np.float32), (0, 0), 3)
    try:
        _, warp = cv2.findTransformECC(
            dst,
            src,
            warp,
            motion,
            (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 100, 1e-5),
            None,
            5,
        )
    except cv2.error:
        return (
            cand_rgb,
            cand_a,
        )  # no convergence: compare unaligned (the shape IoU will tell)
    flags = cv2.INTER_LINEAR + cv2.WARP_INVERSE_MAP
    rgb = cv2.warpAffine(
        cand_rgb,
        warp,
        (SIDE, SIDE),
        flags=flags,
        borderMode=cv2.BORDER_CONSTANT,
        borderValue=(255, 255, 255),
    )
    a = cv2.warpAffine(
        cand_a.astype(np.float32),
        warp,
        (SIDE, SIDE),
        flags=flags,
        borderMode=cv2.BORDER_CONSTANT,
        borderValue=0,
    )
    return rgb, a


def _masked_ssim(x: np.ndarray, y: np.ndarray, mask: np.ndarray) -> float:
    """Mean SSIM (Gaussian window, σ=1.5) over the pixels inside ``mask``."""
    x = x.astype(np.float64)
    y = y.astype(np.float64)
    c1, c2 = (0.01 * 255) ** 2, (0.03 * 255) ** 2
    blur = lambda im: cv2.GaussianBlur(im, (11, 11), 1.5)  # noqa: E731
    mx, my = blur(x), blur(y)
    sxx = blur(x * x) - mx * mx
    syy = blur(y * y) - my * my
    sxy = blur(x * y) - mx * my
    ssim = ((2 * mx * my + c1) * (2 * sxy + c2)) / (
        (mx * mx + my * my + c1) * (sxx + syy + c2)
    )
    inner = cv2.erode(mask.astype(np.uint8), np.ones((7, 7), np.uint8)) > 0
    return float(ssim[inner].mean()) if inner.any() else 0.0


def compare_cutouts(
    reference: Image.Image,
    candidate: Image.Image,
    limits: FidelityLimits = FidelityLimits(),
) -> Fidelity:
    ref_rgb, ref_a = _letterbox(reference)
    cand_rgb0, cand_a0 = _letterbox(candidate)
    ref_m = ref_a > 0.5
    # Shape on a rigid fit (rotation + shift): an affine fit would stretch away a missing sleeve.
    _, rigid_a = _align(ref_a, cand_rgb0, cand_a0, cv2.MOTION_EUCLIDEAN)
    rigid_m = rigid_a > 0.5
    union = np.logical_or(ref_m, rigid_m).sum()
    iou = float(np.logical_and(ref_m, rigid_m).sum() / union) if union else 0.0
    # Colour and texture pixel by pixel on an affine fit (absorbs the generator's small rescaling).
    cand_rgb, cand_a = _align(ref_a, cand_rgb0, cand_a0, cv2.MOTION_AFFINE)
    both = np.logical_and(ref_m, cand_a > 0.5)

    ref_lab = rgb_to_lab(ref_rgb.reshape(-1, 3).astype(np.float64)).reshape(
        SIDE, SIDE, 3
    )
    cand_lab = rgb_to_lab(cand_rgb.reshape(-1, 3).astype(np.float64)).reshape(
        SIDE, SIDE, 3
    )
    step = SIDE // GRID
    des: list[float] = []
    for gy in range(GRID):
        for gx in range(GRID):
            sl = (slice(gy * step, (gy + 1) * step), slice(gx * step, (gx + 1) * step))
            cell = both[sl]
            if cell.mean() < MIN_CELL_COVER:
                continue
            des.append(
                float(
                    delta_e2000(
                        ref_lab[sl][cell].mean(axis=0), cand_lab[sl][cell].mean(axis=0)
                    )
                )
            )
    d = np.array(des) if des else np.array([99.0])
    gray = lambda rgb: cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)  # noqa: E731
    ssim = _masked_ssim(gray(ref_rgb), gray(cand_rgb), both)

    reasons: list[str] = []
    if iou < limits.min_shape_iou:
        reasons.append("Ha cambiado la forma de la prenda.")
    if float(d.mean()) > limits.max_mean_delta_e:
        reasons.append("Ha cambiado el color de la prenda.")
    elif (
        float(d.max()) > limits.max_cell_delta_e
        or float(np.percentile(d, 90)) > limits.max_p90_delta_e
    ):
        reasons.append(
            "Ha cambiado el color de alguna zona (botones, bolsillos, estampado…)."
        )
    if ssim < limits.min_ssim:
        reasons.append("Ha cambiado la textura o el dibujo del tejido.")
    return Fidelity(
        shape_iou=round(iou, 4),
        mean_delta_e=round(float(d.mean()), 3),
        p90_delta_e=round(float(np.percentile(d, 90)), 3),
        max_cell_delta_e=round(float(d.max()), 3),
        ssim=round(ssim, 4),
        cells=len(des),
        passed=not reasons,
        reasons=reasons,
    )
