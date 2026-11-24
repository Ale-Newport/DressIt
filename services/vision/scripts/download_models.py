"""Download (and load once) every model the real backend uses, into VISION_MODELS_CACHE.

Used by the Dockerfile (``--build-arg PRELOAD_MODELS=true``) and handy before going
offline. Total ≈ 2.2 GB: FashionSigLIP 0.8 GB, Grounding DINO tiny 0.7 GB, SAM 2.1
small 0.18 GB, rembg isnet-general-use 0.18 GB, EasyOCR es/en ~0.1 GB.

    uv run python scripts/download_models.py [--no-ocr]
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.config import get_settings  # noqa: E402  (sets the cache env vars)
from app.models.torch_backend import TorchBackend  # noqa: E402
from PIL import Image  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-ocr", action="store_true")
    args = ap.parse_args()
    backend = TorchBackend(get_settings())
    t = time.perf_counter()
    backend.warmup(all_models=True)
    if not args.no_ocr:
        backend.ocr(Image.new("RGB", (64, 32), "white"))
    print(f"models ready in {time.perf_counter() - t:.0f}s at {get_settings().models_cache}")
    for name, loaded in backend.models_status().items():
        print(f"  {name}: {'ok' if loaded else 'not loaded'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
