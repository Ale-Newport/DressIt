"""OCR post-processing (no OCR model needed)."""

from __future__ import annotations

from app.models.base import OcrLine
from app.ocr import group_lines, normalize_amounts


def test_normalize_amounts():
    assert normalize_amounts("CAMISA LINO 29 , 95 €") == "CAMISA LINO 29,95 €"
    assert normalize_amounts("JERSEY 25, 99 €") == "JERSEY 25,99 €"
    assert normalize_amounts("TOTAL 95 .89") == "TOTAL 95.89"
    assert (
        normalize_amounts("C/ Gran Vía 1, 28013 Madrid")
        == "C/ Gran Vía 1, 28013 Madrid"
    )


def test_group_lines_reading_order():
    words = [
        OcrLine("29,95", 0.9, (0.7, 0.10, 0.85, 0.15)),
        OcrLine("CAMISA", 0.8, (0.1, 0.11, 0.3, 0.16)),
        OcrLine("TOTAL", 0.95, (0.1, 0.30, 0.3, 0.35)),
    ]
    text, lines = group_lines(words)
    assert text == "CAMISA 29,95\nTOTAL"
    assert len(lines) == 2 and lines[0].box == (0.1, 0.10, 0.85, 0.16)
