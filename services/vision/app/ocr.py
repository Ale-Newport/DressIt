"""OCR for receipts, care labels and shop screenshots (Spanish + English).

EasyOCR (Apache-2.0; CRAFT detector + CRNN recogniser) is loaded lazily on the
first ``/v1/ocr`` call — it is never needed by ``/v1/analyze``. Weights go to
``models_cache/easyocr``. Images are downscaled to ≤ 2000 px (enough for
receipt text, bounded latency).
"""

from __future__ import annotations

import os
import re
from typing import Sequence

import numpy as np
from PIL import Image

from .models.base import OcrLine

OCR_MAX_SIDE = 2000


class EasyOcrEngine:
    def __init__(self, languages: Sequence[str], gpu: bool = False) -> None:
        import easyocr

        storage = os.environ.get("EASYOCR_MODULE_PATH")
        model_dir = os.path.join(storage, "model") if storage else None
        if model_dir:
            os.makedirs(model_dir, exist_ok=True)
        self.languages = list(languages)
        self.reader = easyocr.Reader(
            self.languages,
            gpu=gpu,
            model_storage_directory=model_dir,
            verbose=False,
            download_enabled=True,
        )
        self.version = f"easyocr {easyocr.__version__} ({'+'.join(self.languages)})"

    def read(self, image: Image.Image) -> list[OcrLine]:
        img = image.convert("RGB")
        w, h = img.size
        scale = min(1.0, OCR_MAX_SIDE / max(w, h))
        if scale < 1.0:
            img = img.resize(
                (round(w * scale), round(h * scale)), Image.Resampling.LANCZOS
            )
        sw, sh = img.size
        results = self.reader.readtext(np.asarray(img), detail=1, paragraph=False)
        lines: list[OcrLine] = []
        for quad, text, conf in results:
            xs = [float(p[0]) for p in quad]
            ys = [float(p[1]) for p in quad]
            lines.append(
                OcrLine(
                    text=str(text).strip(),
                    confidence=float(conf),
                    box=(min(xs) / sw, min(ys) / sh, max(xs) / sw, max(ys) / sh),
                )
            )
        return [ln for ln in lines if ln.text]


_SPLIT_DECIMAL = re.compile(
    r"(\d)\s*([,.])\s+(\d{2})(?!\d)|(\d)\s+([,.])\s*(\d{2})(?!\d)"
)


def normalize_amounts(text: str) -> str:
    """Re-join prices the recogniser split ("29 , 95 €" → "29,95 €"). Only 2-digit decimals
    are joined, so "Gran Vía 1, 28013" is left alone."""
    return _SPLIT_DECIMAL.sub(lambda m: "".join(g for g in m.groups() if g), text)


def group_lines(lines: list[OcrLine]) -> tuple[str, list[OcrLine]]:
    """Merge word boxes into reading-order lines (receipts: left→right, top→bottom)."""
    if not lines:
        return "", []
    items = sorted(lines, key=lambda ln: ((ln.box[1] + ln.box[3]) / 2, ln.box[0]))
    rows: list[list[OcrLine]] = []
    for ln in items:
        cy = (ln.box[1] + ln.box[3]) / 2
        hgt = ln.box[3] - ln.box[1]
        if rows:
            last = rows[-1]
            ly = np.mean([(r.box[1] + r.box[3]) / 2 for r in last])
            lh = np.mean([r.box[3] - r.box[1] for r in last])
            if abs(cy - ly) < 0.5 * max(hgt, lh):
                last.append(ln)
                continue
        rows.append([ln])
    merged: list[OcrLine] = []
    for row in rows:
        row.sort(key=lambda r: r.box[0])
        merged.append(
            OcrLine(
                text=normalize_amounts(" ".join(r.text for r in row)),
                confidence=float(np.mean([r.confidence for r in row])),
                box=(
                    min(r.box[0] for r in row),
                    min(r.box[1] for r in row),
                    max(r.box[2] for r in row),
                    max(r.box[3] for r in row),
                ),
            )
        )
    return "\n".join(m.text for m in merged), merged
