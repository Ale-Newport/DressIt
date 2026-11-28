#!/usr/bin/env bash
# Studio-photo and try-on server without ComfyUI: FLUX.2 klein 4B in MLX (mflux) makes the studio photo and
# dresses the user; Qwen3.5-35B-A3B (mlx-vlm) finds, describes and checks each garment; both kept in
# memory (~36 GB). MLX_VLM=none skips the vision-language model.
# The API uses it with IMAGEGEN_MLX_URL=http://127.0.0.1:8189 (PACKSHOT_PROVIDERS includes `mlx`).
# First run: creates .mflux-venv and downloads the weights from Hugging Face (Apache-2.0):
# FLUX.2 klein 4B ~15 GB, Qwen3.5-35B-A3B 4-bit ~20 GB.
set -euo pipefail
cd "$(dirname "$0")"
# Install (or finish an interrupted install) until both packages import.
if ! .mflux-venv/bin/python -c "import mflux, mlx_vlm" 2>/dev/null; then
  [ -x .mflux-venv/bin/python ] || uv venv .mflux-venv --python 3.12 -q
  VIRTUAL_ENV=.mflux-venv uv pip install -q "mflux==0.24.0" "mlx-vlm==0.8.1"
fi
exec .mflux-venv/bin/python mlx/server.py "$@"
