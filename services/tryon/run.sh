#!/usr/bin/env bash
# Starts the try-on service on http://127.0.0.1:8002 (API: TRYON_SERVICE_URL).
set -euo pipefail
cd "$(dirname "$0")"
export PYTORCH_ENABLE_MPS_FALLBACK=1
exec uv run uvicorn app.main:app --host 127.0.0.1 --port "${TRYON_PORT:-8002}"
