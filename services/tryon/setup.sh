#!/usr/bin/env bash
# Installs the DressIt virtual try-on service (services/tryon): Python environment and weights.
#
#   FASHN VTON v1.5    fashn-ai/fashn-vton-1.5            Apache-2.0        ~1.9 GB
#   DWPose (onnx)      fashn-ai/DWPose                    Apache-2.0        ~0.35 GB
#   Sapiens2-seg-0.4b  facebook/sapiens2-seg-0.4b         Sapiens2 License  ~1.6 GB
#
# FASHN's own human parser (fashn-ai/fashn-human-parser) is NOT downloaded: its weights are
# non-commercial (NVIDIA SegFormer licence). DressIt builds the clothing-agnostic mask with
# Sapiens2 instead — read docs/probador-virtual.md (licences) before commercial use.
#
# Re-running it resumes interrupted downloads and skips files already present.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
MODELS="${TRYON_MODELS:-$HERE/models}"

echo "→ Entorno de Python (uv)"
cd "$HERE"
uv sync

# get <repo> <file> <folder under models/>
get() {
  local repo="$1" path="$2" dest="$MODELS/$3"
  local file="$dest/$(basename "$path")"
  mkdir -p "$dest"
  if [ -f "$file" ] && [ ! -f "$file.part" ]; then echo "  ✓ $3/$(basename "$path")"; return; fi
  echo "  ↓ $repo/$path"
  curl -fL --retry 5 --retry-delay 5 -C - -o "$file.part" "https://huggingface.co/$repo/resolve/main/$path"
  mv "$file.part" "$file"
}

echo "→ Pesos (en $MODELS)"
get fashn-ai/fashn-vton-1.5 model.safetensors fashn-vton-1.5
get fashn-ai/DWPose yolox_l.onnx dwpose
get fashn-ai/DWPose dw-ll_ucoco_384.onnx dwpose
for f in config.json preprocessor_config.json model.safetensors; do get facebook/sapiens2-seg-0.4b "$f" sapiens2-seg-0.4b; done

echo "✓ Listo. Arranca el servicio con services/tryon/run.sh y define TRYON_SERVICE_URL=http://localhost:8002"
