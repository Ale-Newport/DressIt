# DressIt vision service — CPU image (Linux x86_64/arm64).
#   docker build -t dressit-vision services/vision
#   docker build --build-arg PRELOAD_MODELS=true -t dressit-vision services/vision   # bake ~2.2 GB of weights
#   docker run -p 8001:8001 -v dressit-models:/models dressit-vision
# Without PRELOAD_MODELS the weights are downloaded on first use into /models (mount a volume).
FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    VISION_BACKEND=torch \
    VISION_DEVICE=cpu \
    VISION_PORT=8001 \
    VISION_MODELS_CACHE=/models \
    HF_HOME=/models/hf \
    TORCH_HOME=/models/torch \
    U2NET_HOME=/models/rembg \
    EASYOCR_MODULE_PATH=/models/easyocr \
    OMP_NUM_THREADS=4

RUN apt-get update \
    && apt-get install -y --no-install-recommends libgomp1 curl \
    && rm -rf /var/lib/apt/lists/*
COPY --from=ghcr.io/astral-sh/uv:0.9.7 /uv /usr/local/bin/uv

WORKDIR /srv
# Dependencies first (layer cache). Linux resolves torch/torchvision from the CPU-only index (see pyproject).
COPY pyproject.toml uv.lock .python-version ./
RUN uv sync --frozen --no-dev --no-install-project

COPY app ./app
COPY scripts ./scripts

RUN useradd --create-home --uid 10001 vision && mkdir -p /models && chown -R vision /models /srv
USER vision

ARG PRELOAD_MODELS=false
RUN if [ "$PRELOAD_MODELS" = "true" ]; then uv run --no-sync python scripts/download_models.py; fi

EXPOSE 8001
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s CMD curl -fsS http://localhost:${VISION_PORT}/health || exit 1
CMD ["sh", "-c", "exec uv run --no-sync uvicorn app.main:app --host 0.0.0.0 --port ${VISION_PORT} --workers 1"]
