"""Colour science, numerically identical to ``packages/shared/src/colors.ts``.

* sRGB (D65) → linear → XYZ → CIELAB with the same matrix, white point and
  piecewise ``f`` as the TS implementation (plus the exact inverse for hex output).
* CIEDE2000 following Sharma, Wu & Dalal (2005), vectorised with NumPy.
* ``nearest_color_family`` skips metallic families exactly like the TS version.
* ``extract_colors``: dominant colours of *masked* pixels via deterministic
  k-means(++) in CIELAB, then perceptual merging with CIEDE2000.
"""

from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache

import numpy as np

from .vocabulary import load_vocabulary

_M_RGB_TO_XYZ = np.array(
    [
        [0.4124564, 0.3575761, 0.1804375],
        [0.2126729, 0.7151522, 0.072175],
        [0.0193339, 0.119192, 0.9503041],
    ],
    dtype=np.float64,
)
_WHITE = np.array([0.95047, 1.0, 1.08883], dtype=np.float64)
_M_XYZ_TO_RGB = np.linalg.inv(_M_RGB_TO_XYZ)
_EPS = 216 / 24389
_KAPPA = 24389 / 27


def hex_to_rgb(hex_str: str) -> tuple[int, int, int]:
    s = hex_str.strip().lstrip("#")
    if len(s) != 6:
        raise ValueError(f"Color hex inválido: {hex_str}")
    n = int(s, 16)
    return (n >> 16) & 255, (n >> 8) & 255, n & 255


def rgb_to_hex(rgb: tuple[float, float, float] | np.ndarray) -> str:
    vals = [int(max(0, min(255, round(float(v))))) for v in rgb]
    return "#{:02x}{:02x}{:02x}".format(*vals)


def srgb_to_linear(c: np.ndarray) -> np.ndarray:
    v = np.asarray(c, dtype=np.float64) / 255.0
    return np.where(v <= 0.04045, v / 12.92, ((v + 0.055) / 1.055) ** 2.4)


def linear_to_srgb(v: np.ndarray) -> np.ndarray:
    v = np.clip(np.asarray(v, dtype=np.float64), 0.0, 1.0)
    out = np.where(v <= 0.0031308, 12.92 * v, 1.055 * np.power(v, 1 / 2.4) - 0.055)
    return out * 255.0


def rgb_to_lab(rgb: np.ndarray | tuple[float, float, float]) -> np.ndarray:
    """sRGB 0–255 (``(..., 3)``) → CIELAB D65 (``(..., 3)``)."""
    lin = srgb_to_linear(np.asarray(rgb, dtype=np.float64))
    xyz = lin @ _M_RGB_TO_XYZ.T / _WHITE
    f = np.where(xyz > _EPS, np.cbrt(xyz), (_KAPPA * xyz + 16) / 116)
    fx, fy, fz = f[..., 0], f[..., 1], f[..., 2]
    return np.stack([116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)], axis=-1)


def lab_to_rgb(lab: np.ndarray | tuple[float, float, float]) -> np.ndarray:
    """Inverse of :func:`rgb_to_lab` (values clipped to the sRGB gamut)."""
    lab = np.asarray(lab, dtype=np.float64)
    fy = (lab[..., 0] + 16) / 116
    fx = fy + lab[..., 1] / 500
    fz = fy - lab[..., 2] / 200
    f = np.stack([fx, fy, fz], axis=-1)
    xyz = np.where(f**3 > _EPS, f**3, (116 * f - 16) / _KAPPA) * _WHITE
    lin = xyz @ _M_XYZ_TO_RGB.T
    return linear_to_srgb(lin)


def hex_to_lab(hex_str: str) -> np.ndarray:
    return rgb_to_lab(np.array(hex_to_rgb(hex_str), dtype=np.float64))


def delta_e2000(lab1: np.ndarray, lab2: np.ndarray) -> np.ndarray:
    """CIEDE2000 between broadcastable Lab arrays (``(..., 3)``)."""
    lab1 = np.asarray(lab1, dtype=np.float64)
    lab2 = np.asarray(lab2, dtype=np.float64)
    L1, a1, b1 = lab1[..., 0], lab1[..., 1], lab1[..., 2]
    L2, a2, b2 = lab2[..., 0], lab2[..., 1], lab2[..., 2]
    rad = np.pi / 180
    C1 = np.hypot(a1, b1)
    C2 = np.hypot(a2, b2)
    Cbar = (C1 + C2) / 2
    G = 0.5 * (1 - np.sqrt(Cbar**7 / (Cbar**7 + 25.0**7)))
    a1p = (1 + G) * a1
    a2p = (1 + G) * a2
    C1p = np.hypot(a1p, b1)
    C2p = np.hypot(a2p, b2)

    def hue(a: np.ndarray, b: np.ndarray) -> np.ndarray:
        h = np.degrees(np.arctan2(b, a))
        h = np.where(h < 0, h + 360, h)
        return np.where((a == 0) & (b == 0), 0.0, h)

    h1p = hue(a1p, b1)
    h2p = hue(a2p, b2)
    dLp = L2 - L1
    dCp = C2p - C1p
    nonzero = (C1p * C2p) != 0
    dhp = h2p - h1p
    dhp = np.where(dhp > 180, dhp - 360, np.where(dhp < -180, dhp + 360, dhp))
    dhp = np.where(nonzero, dhp, 0.0)
    dHp = 2 * np.sqrt(C1p * C2p) * np.sin(dhp * rad / 2)
    Lbarp = (L1 + L2) / 2
    Cbarp = (C1p + C2p) / 2
    hsum = h1p + h2p
    hbarp = np.where(
        np.abs(h1p - h2p) <= 180,
        hsum / 2,
        np.where(hsum < 360, (hsum + 360) / 2, (hsum - 360) / 2),
    )
    hbarp = np.where(nonzero, hbarp, hsum)
    T = (
        1
        - 0.17 * np.cos((hbarp - 30) * rad)
        + 0.24 * np.cos(2 * hbarp * rad)
        + 0.32 * np.cos((3 * hbarp + 6) * rad)
        - 0.2 * np.cos((4 * hbarp - 63) * rad)
    )
    dTheta = 30 * np.exp(-(((hbarp - 275) / 25) ** 2))
    Rc = 2 * np.sqrt(Cbarp**7 / (Cbarp**7 + 25.0**7))
    Sl = 1 + (0.015 * (Lbarp - 50) ** 2) / np.sqrt(20 + (Lbarp - 50) ** 2)
    Sc = 1 + 0.045 * Cbarp
    Sh = 1 + 0.015 * Cbarp * T
    Rt = -np.sin(2 * dTheta * rad) * Rc
    return np.sqrt(
        (dLp / Sl) ** 2
        + (dCp / Sc) ** 2
        + (dHp / Sh) ** 2
        + Rt * (dCp / Sc) * (dHp / Sh)
    )


@lru_cache(maxsize=1)
def _family_table() -> tuple[tuple[str, ...], np.ndarray]:
    fams = [f for f in load_vocabulary().color_families if not f.metallic]
    return tuple(f.id for f in fams), np.stack([hex_to_lab(f.hex) for f in fams])


def nearest_color_family(color: str | np.ndarray) -> tuple[str, float]:
    """Nearest non-metallic colour family by CIEDE2000 → ``(family_id, distance)``."""
    lab = (
        hex_to_lab(color)
        if isinstance(color, str)
        else np.asarray(color, dtype=np.float64)
    )
    ids, labs = _family_table()
    d = delta_e2000(lab[None, :], labs)
    i = int(np.argmin(d))
    return ids[i], float(d[i])


@dataclass(frozen=True)
class DominantColor:
    hex: str
    family: str
    share: float
    lab: tuple[float, float, float]

    def to_dict(self) -> dict[str, object]:
        return {"hex": self.hex, "family": self.family, "share": round(self.share, 4)}


def kmeans_lab(
    points: np.ndarray, k: int, *, iters: int = 30, seed: int = 0
) -> tuple[np.ndarray, np.ndarray]:
    """Deterministic k-means++ (Euclidean in Lab ≈ ΔE76). Returns ``(centroids, labels)``."""
    n = points.shape[0]
    k = max(1, min(k, n))
    rng = np.random.default_rng(seed)
    centroids = np.empty((k, 3), dtype=np.float64)
    centroids[0] = points[rng.integers(n)]
    d2 = np.sum((points - centroids[0]) ** 2, axis=1)
    for j in range(1, k):
        total = d2.sum()
        if total <= 1e-12:
            centroids = centroids[:j]
            break
        centroids[j] = points[rng.choice(n, p=d2 / total)]
        d2 = np.minimum(d2, np.sum((points - centroids[j]) ** 2, axis=1))
    labels = np.zeros(n, dtype=np.int64)
    for _ in range(iters):
        dist = np.sum((points[:, None, :] - centroids[None, :, :]) ** 2, axis=2)
        new_labels = np.argmin(dist, axis=1)
        new_centroids = np.array(
            [
                points[new_labels == j].mean(axis=0)
                if np.any(new_labels == j)
                else centroids[j]
                for j in range(len(centroids))
            ]
        )
        converged = np.array_equal(new_labels, labels) and np.allclose(
            new_centroids, centroids
        )
        labels, centroids = new_labels, new_centroids
        if converged:
            break
    return centroids, labels


def extract_colors(
    pixels_rgb: np.ndarray,
    *,
    max_colors: int = 3,
    k: int = 6,
    merge_delta_e: float = 10.0,
    same_family_merge_delta_e: float = 22.0,
    min_share: float = 0.08,
    max_samples: int = 20000,
    seed: int = 0,
) -> list[DominantColor]:
    """Dominant colours of the given (already masked) ``(N, 3)`` uint8 RGB pixels.

    1. Deterministic subsample (≤ ``max_samples``) → CIELAB.
    2. k-means++ with ``k`` clusters (over-segmenting shading on purpose).
    3. Greedy merge of the closest pair while ΔE2000 < ``merge_delta_e``, or
       < ``same_family_merge_delta_e`` when both map to the same colour family
       (folds/shadows of one fabric).
    4. Drop clusters under ``min_share``, keep ``max_colors``, renormalise shares.
    5. Each colour is the per-channel Lab median of its pixels (robust to highlights);
       ``family`` = nearest colour family by CIEDE2000.
    """
    px = np.asarray(pixels_rgb).reshape(-1, 3)
    if px.shape[0] < 16:
        return []
    if px.shape[0] > max_samples:
        idx = np.random.default_rng(seed).choice(
            px.shape[0], size=max_samples, replace=False
        )
        px = px[np.sort(idx)]
    lab = rgb_to_lab(px.astype(np.float64))
    centroids, labels = kmeans_lab(lab, k, seed=seed)
    # [centroid, weight, member k-means labels]
    clusters: list[list] = [
        [centroids[j], float(np.sum(labels == j)), {j}]
        for j in range(len(centroids))
        if np.any(labels == j)
    ]

    def family(c: np.ndarray) -> str:
        return nearest_color_family(c)[0]

    while len(clusters) > 1:
        best: tuple[float, int, int] | None = None
        for i in range(len(clusters)):
            for j in range(i + 1, len(clusters)):
                d = float(delta_e2000(clusters[i][0], clusters[j][0]))
                limit = (
                    same_family_merge_delta_e
                    if family(clusters[i][0]) == family(clusters[j][0])
                    else merge_delta_e
                )
                if d < limit and (best is None or d < best[0]):
                    best = (d, i, j)
        if best is None:
            break
        _, i, j = best
        wi, wj = clusters[i][1], clusters[j][1]
        merged = [
            (clusters[i][0] * wi + clusters[j][0] * wj) / (wi + wj),
            wi + wj,
            clusters[i][2] | clusters[j][2],
        ]
        clusters = [c for t, c in enumerate(clusters) if t not in (i, j)] + [merged]

    total = sum(c[1] for c in clusters)
    clusters.sort(key=lambda c: c[1], reverse=True)
    kept = [c for c in clusters if c[1] / total >= min_share][:max_colors] or clusters[
        :1
    ]
    kept_total = sum(c[1] for c in kept)
    out: list[DominantColor] = []
    for _, weight, members in kept:
        # Representative = per-channel median of the member pixels: robust to specular
        # highlights and fold shadows that pull a mean towards grey.
        rep = np.median(lab[np.isin(labels, list(members))], axis=0)
        fam, _ = nearest_color_family(rep)
        out.append(
            DominantColor(
                hex=rgb_to_hex(lab_to_rgb(rep)),
                family=fam,
                share=weight / kept_total,
                lab=(float(rep[0]), float(rep[1]), float(rep[2])),
            )
        )
    return out
