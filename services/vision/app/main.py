"""FastAPI app for the DressIt vision service.

Run: ``uv run uvicorn app.main:app --port 8001``. Endpoints are synchronous
(``def``) so FastAPI runs them in its threadpool; model access is serialised
per model inside the backend and the number of concurrent analyses is bounded
by ``VISION_MAX_CONCURRENCY`` (memory guard). Images are processed in memory
only: nothing is written to disk or sent to third parties.
"""

from __future__ import annotations

import logging
import os
import threading
from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import FastAPI, File, Form, Request, UploadFile
from fastapi.responses import JSONResponse

from .config import VERSION, get_settings
from .imaging import ImageDecodeError, decode_image
from .models import get_backend
from .ocr import group_lines
from .pipeline.analyze import analyze_image
from .pipeline.classify import get_heads
from .pipeline.search import embed_text_queries, embed_whole_image
from .schemas import (
    AnalyzeResponse,
    EmbedResponse,
    EmbedTextRequest,
    EmbedTextResponse,
    ErrorResponse,
    HealthResponse,
    OcrResponse,
)

log = logging.getLogger("vision")
logging.basicConfig(level=os.environ.get("VISION_LOG_LEVEL", "INFO"))


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status, self.code, self.message = status, code, message


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    settings = get_settings()
    backend = get_backend()
    preload = os.environ.get("VISION_PRELOAD", "none").lower()
    if backend.name == "torch" and preload in {"embedding", "all"}:

        def _warm() -> None:
            backend.warmup(all_models=preload == "all")  # type: ignore[attr-defined]
            get_heads(backend, settings)  # text prototypes of every zero-shot head

        threading.Thread(target=_warm, daemon=True).start()
    log.info("vision %s backend=%s device=%s", VERSION, settings.backend, backend.device)
    yield


app = FastAPI(
    title="DressIt Vision",
    version=VERSION,
    description="Recorte, atributos, colores, embeddings y OCR de prendas. Las imágenes se procesan en memoria y no se guardan.",
    lifespan=lifespan,
)
_slots = threading.BoundedSemaphore(get_settings().max_concurrency)
ERRORS = {413: {"model": ErrorResponse}, 415: {"model": ErrorResponse}, 422: {"model": ErrorResponse}}


@app.exception_handler(ApiError)
async def _api_error(_: Request, exc: ApiError) -> JSONResponse:
    return JSONResponse(status_code=exc.status, content={"error": {"code": exc.code, "message": exc.message}})


@app.exception_handler(ImageDecodeError)
async def _decode_error(_: Request, exc: ImageDecodeError) -> JSONResponse:
    return JSONResponse(status_code=415, content={"error": {"code": exc.code, "message": exc.message}})


def _read_upload(file: UploadFile) -> bytes:
    limit = get_settings().max_upload_bytes
    data = file.file.read(limit + 1)
    if len(data) > limit:
        raise ApiError(413, "file_too_large", f"La imagen supera el máximo de {limit // (1024 * 1024)} MB.")
    if not data:
        raise ApiError(422, "empty_file", "El fichero está vacío.")
    return data


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    backend = get_backend()
    return HealthResponse(status="ok", device=backend.device, backend=backend.name, models=backend.models_status(), version=VERSION)


@app.post("/v1/analyze", response_model=AnalyzeResponse, responses=ERRORS)
def analyze(
    file: UploadFile = File(...),
    mode: str = Form("single"),
    max_items: int = Form(8),
) -> AnalyzeResponse | JSONResponse:
    settings = get_settings()
    if mode not in {"single", "multi"}:
        raise ApiError(422, "invalid_mode", "mode debe ser 'single' o 'multi'.")
    if not 1 <= max_items <= settings.max_items_limit:
        raise ApiError(422, "invalid_max_items", f"max_items debe estar entre 1 y {settings.max_items_limit}.")
    data = _read_upload(file)
    with _slots:
        result = analyze_image(data, mode=mode, max_items=max_items, backend=get_backend(), settings=settings)
    return JSONResponse(result)


@app.post("/v1/embed/image", response_model=EmbedResponse, responses=ERRORS)
def embed_image(file: UploadFile = File(...), segment: bool = Form(False)) -> JSONResponse:
    """Embedding of the whole image (catalog/product photos). With ``segment=true`` the main
    garment is cut out first, exactly like ``/v1/analyze`` (use this for user photos)."""
    data = _read_upload(file)
    backend = get_backend()
    with _slots:
        if segment:
            res = analyze_image(data, mode="single", max_items=1, backend=backend, settings=get_settings())
            vec = res["items"][0]["embedding"]
        else:
            vec = [round(float(v), 6) for v in embed_whole_image(backend, decode_image(data).rgb)]
    return JSONResponse({"embedding": vec, "model": backend.embedding_model_id, "dim": len(vec)})


@app.post("/v1/embed/text", response_model=EmbedTextResponse, responses=ERRORS)
def embed_text(body: EmbedTextRequest) -> JSONResponse:
    texts = [t.strip() for t in body.texts]
    if any(not t or len(t) > 300 for t in texts):
        raise ApiError(422, "invalid_text", "Cada texto debe tener entre 1 y 300 caracteres.")
    backend = get_backend()
    emb, translated = embed_text_queries(backend, texts)
    return JSONResponse(
        {
            "embeddings": [[round(float(v), 6) for v in row] for row in emb],
            "model": backend.embedding_model_id,
            "dim": int(emb.shape[1]),
            "translated": translated,
        }
    )


@app.post("/v1/ocr", response_model=OcrResponse, responses=ERRORS)
def ocr(file: UploadFile = File(...)) -> JSONResponse:
    data = _read_upload(file)
    backend = get_backend()
    image = decode_image(data).rgb
    with _slots:
        raw = backend.ocr(image)
    text, lines = group_lines(raw)
    model = "stub" if backend.name == "stub" else "easyocr:" + "+".join(get_settings().ocr_languages)
    return JSONResponse(
        {
            "text": text,
            "lines": [{"text": ln.text, "confidence": round(ln.confidence, 4), "bbox": [round(v, 4) for v in ln.box]} for ln in lines],
            "model": model,
        }
    )
