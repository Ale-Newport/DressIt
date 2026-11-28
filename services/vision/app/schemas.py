"""Pydantic response models (the HTTP contract; all keys snake_case)."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class Alternative(BaseModel):
    value: str
    confidence: float


class Predicted(BaseModel):
    value: str
    confidence: float
    alternatives: list[Alternative] = Field(default_factory=list)


class PredictedSet(BaseModel):
    value: list[str]
    confidence: float


class ColorOut(BaseModel):
    hex: str
    family: str
    share: float


class QualityOut(BaseModel):
    blur: float = Field(description="0 = nítida … 1 = muy borrosa")
    brightness: float = Field(description="Luminosidad media L*/100 del recorte (0–1)")
    warnings: list[str]


class ItemOut(BaseModel):
    bbox: list[float] = Field(
        description="[x0, y0, x1, y1] normalised 0–1 in the EXIF-corrected image"
    )
    cutout_png_base64: str
    mask_area_ratio: float
    detection_score: float | None = None
    box_index: int | None = None  # with external boxes: which one this item came from
    category: Predicted | None
    subcategory: Predicted | None
    colors: list[ColorOut]
    pattern: Predicted | None
    materials: PredictedSet | None
    styles: PredictedSet | None
    seasons: PredictedSet | None
    fit: Predicted | None
    embedding: list[float]
    embedding_model: str
    quality: QualityOut
    upright_rotation: float = 0.0


class ImageInfo(BaseModel):
    width: int
    height: int
    sha256: str
    phash: str = Field(description="64-bit DCT perceptual hash, 16 hex chars")
    exif_transposed: bool


class SceneOut(BaseModel):
    value: Literal["single", "multiple", "worn"]
    confidence: float


class AnalyzeResponse(BaseModel):
    image: ImageInfo
    items: list[ItemOut]
    scene: SceneOut | None = None
    timings_ms: dict[str, float]
    model_versions: dict[str, str]


class EmbedResponse(BaseModel):
    embedding: list[float]
    model: str
    dim: int


class EmbedTextRequest(BaseModel):
    texts: list[str] = Field(min_length=1, max_length=64)


class EmbedTextResponse(BaseModel):
    embeddings: list[list[float]]
    model: str
    dim: int
    translated: list[str] = Field(
        description="English text actually embedded (Spanish queries are rewritten)"
    )


class OcrLineOut(BaseModel):
    text: str
    confidence: float
    bbox: list[float]


class OcrResponse(BaseModel):
    text: str
    lines: list[OcrLineOut]
    model: str


class HealthResponse(BaseModel):
    status: str
    device: str
    backend: str
    models: dict[str, bool]
    version: str


class ErrorBody(BaseModel):
    code: str
    message: str


class ErrorResponse(BaseModel):
    error: ErrorBody
