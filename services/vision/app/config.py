"""Runtime configuration (environment variables) for the vision service.

Importing this module also points every model cache (Hugging Face, torch hub,
rembg, EasyOCR) at ``services/vision/models_cache/`` unless the caller already
set the corresponding variable, so it must be imported before any ML library.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

VERSION = "0.1.0"
SERVICE_DIR = Path(__file__).resolve().parent.parent
APP_DIR = SERVICE_DIR / "app"


def _env_str(name: str, default: str) -> str:
    value = os.environ.get(name)
    return value.strip() if value and value.strip() else default


def _env_float(name: str, default: float) -> float:
    value = os.environ.get(name)
    if value is None or not value.strip():
        return default
    try:
        return float(value)
    except ValueError as exc:  # pragma: no cover - configuration error
        raise ValueError(f"{name} must be a number, got {value!r}") from exc


def _env_int(name: str, default: int) -> int:
    return int(_env_float(name, float(default)))


def _env_bool(name: str, default: bool) -> bool:
    value = os.environ.get(name)
    if value is None or not value.strip():
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


MODELS_CACHE = Path(_env_str("VISION_MODELS_CACHE", str(SERVICE_DIR / "models_cache")))
os.environ.setdefault("HF_HOME", str(MODELS_CACHE / "hf"))
os.environ.setdefault("TORCH_HOME", str(MODELS_CACHE / "torch"))
os.environ.setdefault("U2NET_HOME", str(MODELS_CACHE / "rembg"))
os.environ.setdefault("EASYOCR_MODULE_PATH", str(MODELS_CACHE / "easyocr"))
os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")
# rembg imports pymatting → numba; numba's OpenMP layer clashes with torch's libomp
# on macOS ("OMP: Error #15"). The workqueue layer avoids loading a second libomp.
os.environ.setdefault("NUMBA_THREADING_LAYER", "workqueue")
# Ops that MPS lacks fall back to CPU instead of raising.
os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")


@dataclass(frozen=True)
class Thresholds:
    """Minimum calibrated confidence to emit an attribute (below → ``null``).

    Values were chosen on the calibration split of ``eval/manifest.csv``; see
    docs/vision.md §Umbrales. Every one can be overridden with
    ``VISION_THRESHOLD_<NAME>`` (e.g. ``VISION_THRESHOLD_CATEGORY=0.6``).
    """

    category: float = 0.50
    subcategory: float = 0.40
    pattern: float = 0.60
    material: float = 0.70
    style: float = 0.50
    season: float = 0.60
    fit: float = 0.60
    # Open-vocabulary detector score (Grounding DINO box+text, or OWLv2) to keep a box.
    detection: float = 0.18
    # Probability of the "not a garment" class above which an item is dropped (multi)
    # or reported without attributes (single).
    not_garment: float = 0.50

    @classmethod
    def from_env(cls) -> Thresholds:
        defaults = cls()
        return cls(
            **{
                name: _env_float(
                    f"VISION_THRESHOLD_{name.upper()}", getattr(defaults, name)
                )
                for name in defaults.__dataclass_fields__
            }
        )


@dataclass(frozen=True)
class Settings:
    backend: str = "torch"  # torch | stub
    device: str = "auto"  # auto | mps | cpu | cuda
    port: int = 8001
    models_cache: Path = MODELS_CACHE
    max_upload_bytes: int = 15 * 1024 * 1024
    max_items_limit: int = 12
    # Longest side of the working copy used for analysis (bboxes stay relative to the full image).
    working_max_side: int = 2048
    cutout_max_side: int = 1024
    cutout_padding: float = 0.04
    segmenter: str = "isnet-general-use"
    embedding_model: str = "Marqo/marqo-fashionSigLIP"
    detector_model: str = "IDEA-Research/grounding-dino-tiny"
    # Softmax scale applied to cosine similarities (1 / temperature), calibrated on eval/.
    logit_scale: float = 50.0
    normalize_cutout: bool = True
    # Cutout refinement (docs/vision.md §2, "Limpieza del recorte").
    # Single mode, salient-object path: detector proposals (garments + display supports) are
    # SAM-segmented and every region FashionSigLIP takes for a support is removed.
    remove_supports: bool = True
    support_min_prob: float = 0.5  # P(support) of a region to remove it
    support_min_prob_head_form: float = (
        0.25  # hat photos: a head form at the bottom of the object
    )
    support_max_area: float = (
        0.6  # never remove a region larger than this fraction of the foreground
    )
    proposal_short_side: int = (
        480  # detector input (shortest side) for proposals; multi keeps 800
    )
    max_proposals: int = 10
    # Thin structures crossing the frame border (clothesline, rail) removed from the rembg mask;
    # width threshold = 2 × this fraction of the long side (+1 px).
    thin_border_radius: float = 0.003
    # Layering (a recognised garment inside another one is subtracted from it) also in single mode.
    layer_single: bool = True
    # Foreground colour estimation at semi-transparent edges (pymatting, MIT): no background halo.
    decontaminate_edges: bool = True
    upright_correction: bool = True
    onnx_coreml: bool = (
        True  # use onnxruntime's CoreML EP for rembg when available (macOS)
    )
    ocr_languages: tuple[str, ...] = ("es", "en")
    max_concurrency: int = 2
    thresholds: Thresholds = field(default_factory=Thresholds)

    @classmethod
    def from_env(cls) -> Settings:
        d = cls()
        backend = _env_str("VISION_BACKEND", d.backend).lower()
        if backend not in {"torch", "stub"}:
            raise ValueError(
                f"VISION_BACKEND must be 'torch' or 'stub', got {backend!r}"
            )
        return cls(
            backend=backend,
            device=_env_str("VISION_DEVICE", d.device).lower(),
            port=_env_int("VISION_PORT", d.port),
            models_cache=MODELS_CACHE,
            max_upload_bytes=int(_env_float("VISION_MAX_UPLOAD_MB", 15) * 1024 * 1024),
            max_items_limit=_env_int("VISION_MAX_ITEMS_LIMIT", d.max_items_limit),
            working_max_side=_env_int("VISION_WORKING_MAX_SIDE", d.working_max_side),
            cutout_max_side=_env_int("VISION_CUTOUT_MAX_SIDE", d.cutout_max_side),
            segmenter=_env_str("VISION_SEGMENTER", d.segmenter),
            embedding_model=_env_str("VISION_EMBEDDING_MODEL", d.embedding_model),
            detector_model=_env_str("VISION_DETECTOR_MODEL", d.detector_model),
            logit_scale=_env_float("VISION_LOGIT_SCALE", d.logit_scale),
            normalize_cutout=_env_bool("VISION_NORMALIZE_CUTOUT", d.normalize_cutout),
            remove_supports=_env_bool("VISION_REMOVE_SUPPORTS", d.remove_supports),
            support_min_prob=_env_float("VISION_SUPPORT_MIN_PROB", d.support_min_prob),
            support_min_prob_head_form=_env_float(
                "VISION_SUPPORT_MIN_PROB_HEAD_FORM", d.support_min_prob_head_form
            ),
            support_max_area=_env_float("VISION_SUPPORT_MAX_AREA", d.support_max_area),
            proposal_short_side=_env_int(
                "VISION_PROPOSAL_SHORT_SIDE", d.proposal_short_side
            ),
            max_proposals=_env_int("VISION_MAX_PROPOSALS", d.max_proposals),
            thin_border_radius=_env_float(
                "VISION_THIN_BORDER_RADIUS", d.thin_border_radius
            ),
            layer_single=_env_bool("VISION_LAYER_SINGLE", d.layer_single),
            decontaminate_edges=_env_bool(
                "VISION_DECONTAMINATE_EDGES", d.decontaminate_edges
            ),
            upright_correction=_env_bool(
                "VISION_UPRIGHT_CORRECTION", d.upright_correction
            ),
            onnx_coreml=_env_bool("VISION_ONNX_COREML", d.onnx_coreml),
            ocr_languages=tuple(
                lang.strip()
                for lang in _env_str(
                    "VISION_OCR_LANGS", ",".join(d.ocr_languages)
                ).split(",")
                if lang.strip()
            ),
            max_concurrency=max(
                1, _env_int("VISION_MAX_CONCURRENCY", d.max_concurrency)
            ),
            thresholds=Thresholds.from_env(),
        )


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings.from_env()
