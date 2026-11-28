#!/usr/bin/env bash
# Installs the DressIt image-generation server: ComfyUI (GPL-3.0, run as a separate program),
# the ComfyUI-GGUF custom node (Apache-2.0) and the model weights used by the workflows in
# services/api/src/modules/imagegen/workflows. Every model is Apache-2.0 (commercial use allowed).
#
#   services/imagegen/setup.sh            # everything (~32 GB of weights)
#   services/imagegen/setup.sh qwen       # Qwen-Image-Edit-2511 only (~23 GB)
#   services/imagegen/setup.sh klein      # FLUX.2 klein 4B only (~9 GB)
#
# Re-running it resumes interrupted downloads and skips files already present.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
COMFY="$HERE/comfyui"
WHAT="${1:-all}"
COMFY_REF="${COMFY_REF:-master}"

echo "→ ComfyUI en $COMFY"
if [ ! -d "$COMFY/.git" ]; then
  git clone --depth 1 --branch "$COMFY_REF" https://github.com/Comfy-Org/ComfyUI.git "$COMFY"
fi
if [ ! -d "$COMFY/custom_nodes/ComfyUI-GGUF/.git" ]; then
  git clone --depth 1 https://github.com/city96/ComfyUI-GGUF.git "$COMFY/custom_nodes/ComfyUI-GGUF"
fi

echo "→ Entorno de Python (uv, Python 3.12)"
cd "$COMFY"
[ -d .venv ] || uv venv --python 3.12 .venv
uv pip install --python .venv/bin/python torch torchvision torchaudio
uv pip install --python .venv/bin/python -r requirements.txt -r custom_nodes/ComfyUI-GGUF/requirements.txt

# fetch <repo> <path in repo> <destination folder under models/>
fetch() {
  local repo="$1" path="$2" dest="$COMFY/models/$3"
  local file="$dest/$(basename "$path")"
  mkdir -p "$dest"
  if [ -f "$file" ] && [ ! -f "$file.part" ]; then echo "  ✓ $(basename "$path")"; return; fi
  echo "  ↓ $repo/$path"
  curl -fL --retry 5 --retry-delay 5 -C - -o "$file.part" "https://huggingface.co/$repo/resolve/main/$path"
  mv "$file.part" "$file"
}

if [ "$WHAT" = all ] || [ "$WHAT" = qwen ]; then
  echo "→ Qwen-Image-Edit-2511 (Apache-2.0)"
  fetch unsloth/Qwen-Image-Edit-2511-GGUF qwen-image-edit-2511-Q4_K_M.gguf diffusion_models
  fetch ggml-org/Qwen2.5-VL-7B-Instruct-GGUF Qwen2.5-VL-7B-Instruct-Q8_0.gguf text_encoders
  # Vision projector: Qwen-Image-Edit reads the input images through it (ComfyUI-GGUF finds it
  # next to the text encoder).
  fetch ggml-org/Qwen2.5-VL-7B-Instruct-GGUF mmproj-Qwen2.5-VL-7B-Instruct-f16.gguf text_encoders
  fetch Comfy-Org/Qwen-Image split_files/vae/qwen_image_vae.safetensors vae
  fetch lightx2v/Qwen-Image-Edit-2511-Lightning Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors loras
  # Avatar views (three-quarter / side) of the user's frontal avatar image (Apache-2.0).
  fetch fal/Qwen-Image-Edit-2511-Multiple-Angles-LoRA qwen-image-edit-2511-multiple-angles-lora.safetensors loras
fi

if [ "$WHAT" = all ] || [ "$WHAT" = klein ]; then
  echo "→ FLUX.2 klein 4B (Apache-2.0)"
  fetch unsloth/FLUX.2-klein-4B-GGUF flux-2-klein-4b-Q8_0.gguf diffusion_models
  fetch unsloth/Qwen3-4B-GGUF Qwen3-4B-Q8_0.gguf text_encoders
  fetch Comfy-Org/Flux-2-Klein-4B split_files/vae/flux2-vae.safetensors vae
fi

echo
echo "Listo. Arranca el servidor con:  services/imagegen/run.sh"
