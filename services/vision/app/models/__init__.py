"""Model backends. ``get_backend()`` returns the process-wide singleton chosen by VISION_BACKEND."""

from __future__ import annotations

import threading

from ..config import Settings, get_settings
from .base import Detection, OcrLine, VisionBackend

_lock = threading.Lock()
_backend: VisionBackend | None = None


def create_backend(settings: Settings) -> VisionBackend:
    if settings.backend == "stub":
        from .stub_backend import StubBackend

        return StubBackend()
    from .torch_backend import TorchBackend

    return TorchBackend(settings)


def get_backend() -> VisionBackend:
    global _backend
    if _backend is None:
        with _lock:
            if _backend is None:
                _backend = create_backend(get_settings())
    return _backend


def reset_backend() -> None:
    """Testing hook."""
    global _backend
    with _lock:
        _backend = None


__all__ = ["Detection", "OcrLine", "VisionBackend", "create_backend", "get_backend", "reset_backend"]
