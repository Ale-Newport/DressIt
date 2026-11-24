#!/usr/bin/env bash
# Starts ComfyUI headless for the DressIt API (IMAGEGEN_COMFY_URL=http://127.0.0.1:8188).
# On Apple Silicon: diffusion model in fp16 (bf16 is very slow on MPS), VAE in fp32 and attention
# upcast (fp16 VAE/attention produce black images on MPS).
set -euo pipefail
cd "$(dirname "$0")/comfyui"
EXTRA=()
if [ "$(uname -s)" = Darwin ]; then EXTRA+=(--bf16-unet --fp32-vae); fi
exec .venv/bin/python main.py --listen 127.0.0.1 --port "${COMFY_PORT:-8188}" --disable-auto-launch "${EXTRA[@]}" "$@"
