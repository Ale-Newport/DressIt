"""Builds the ComfyUI API-format workflows used by the DressIt API.

Output: services/api/src/modules/imagegen/workflows/<name>.json (+ <name>.meta.json).
Placeholders filled at run time by the API: {{INPUT_IMAGE}}, {{FACE_IMAGE}}, {{BODY_IMAGE}},
{{OUTFIT_IMAGE}}, {{DESCRIPTION}}, {{PROMPT}}, {{SEED}}, {{WIDTH}}, {{HEIGHT}}.

Graphs follow ComfyUI's official templates (image_qwen_image_edit_2511, image_flux2_klein_image_edit_4b_distilled)
with GGUF loaders (ComfyUI-GGUF) instead of fp8 safetensors (fp8 doesn't run on Apple Silicon).
Run:  python3 services/imagegen/scripts/build_workflows.py
"""
import json
from pathlib import Path

OUT = Path(__file__).resolve().parents[2] / "api" / "src" / "modules" / "imagegen" / "workflows"

AVATAR_PROMPT = (
    "Photorealistic full-body photo of the person in image 1 wearing exactly the clothes shown in image 2 "
    "({{DESCRIPTION}}), replacing the clothes they are wearing. Dress them in every garment of image 2, including any "
    "that looks like what they are wearing now. Keep the person's identity, face (see image 3), hair, "
    "skin tone, body shape and proportions from image 1. Keep every garment exactly as in image 2: same colours, "
    "patterns, prints, logos and shapes. Standing, relaxed natural pose, fully clothed, plain light grey studio "
    "background, soft natural lighting, head to toe in frame. Do not add rips, distressing, prints, jewellery or "
    "accessories that are not in image 2."
)

QWEN = {
    "unet": "qwen-image-edit-2511-Q4_K_M.gguf",
    "clip": "Qwen2.5-VL-7B-Instruct-Q8_0.gguf",
    "vae": "qwen_image_vae.safetensors",
    "lora": "Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors",
}
KLEIN = {"unet": "flux-2-klein-4b-Q8_0.gguf", "clip": "Qwen3-4B-Q8_0.gguf", "vae": "flux2-vae.safetensors"}


ANGLES_LORA = "qwen-image-edit-2511-multiple-angles-lora.safetensors"
VIEW_PROMPT = "<sks> {{DESCRIPTION}} eye-level shot wide shot"


def qwen(images: list[str], prompt: str, prefix: str, extra_lora: str | None = None, canvas: bool = False) -> dict:
    """Qwen-Image-Edit-2511 + Lightning 4-step LoRA. images[0] sets the output size, unless
    ``canvas``: then the output is an empty {{WIDTH}}×{{HEIGHT}} latent (a packshot does not keep
    the framing of the home photo)."""
    wf: dict = {
        "1": {"class_type": "UnetLoaderGGUF", "inputs": {"unet_name": QWEN["unet"]}},
        "2": {"class_type": "CLIPLoaderGGUF", "inputs": {"clip_name": QWEN["clip"], "type": "qwen_image"}},
        "3": {"class_type": "VAELoader", "inputs": {"vae_name": QWEN["vae"]}},
        "4": {"class_type": "LoraLoaderModelOnly", "inputs": {"model": ["1", 0], "lora_name": QWEN["lora"], "strength_model": 1.0}},
        "5": {"class_type": "ModelSamplingAuraFlow", "inputs": {"model": ["7" if extra_lora else "4", 0], "shift": 3.1}},
        "6": {"class_type": "CFGNorm", "inputs": {"model": ["5", 0], "strength": 1.0}},
    }
    if extra_lora:
        wf["7"] = {"class_type": "LoraLoaderModelOnly", "inputs": {"model": ["4", 0], "lora_name": extra_lora, "strength_model": 1.0}}
    refs = []
    for i, placeholder in enumerate(images):
        load, scale = str(10 + 2 * i), str(11 + 2 * i)
        wf[load] = {"class_type": "LoadImage", "inputs": {"image": placeholder}}
        wf[scale] = {"class_type": "FluxKontextImageScale", "inputs": {"image": [load, 0]}}
        refs.append(scale)
    enc = {f"image{i + 1}": [r, 0] for i, r in enumerate(refs)}
    wf["20"] = {"class_type": "TextEncodeQwenImageEditPlus", "inputs": {"clip": ["2", 0], "prompt": prompt, "vae": ["3", 0], **enc}}
    # cfg 1.0 (Lightning): ComfyUI never evaluates the negative, so it is a zeroed copy of the positive
    # instead of a second pass of the 7B vision-language encoder over the images (wasted seconds).
    wf["21"] = {"class_type": "ConditioningZeroOut", "inputs": {"conditioning": ["20", 0]}}
    wf["22"] = {"class_type": "FluxKontextMultiReferenceLatentMethod", "inputs": {"conditioning": ["20", 0], "reference_latents_method": "index_timestep_zero"}}
    wf["23"] = {"class_type": "FluxKontextMultiReferenceLatentMethod", "inputs": {"conditioning": ["21", 0], "reference_latents_method": "index_timestep_zero"}}
    if canvas:
        wf["24"] = {"class_type": "EmptySD3LatentImage", "inputs": {"width": "{{WIDTH}}", "height": "{{HEIGHT}}", "batch_size": 1}}
    else:
        wf["24"] = {"class_type": "VAEEncode", "inputs": {"pixels": [refs[0], 0], "vae": ["3", 0]}}
    wf["25"] = {
        "class_type": "KSampler",
        "inputs": {"model": ["6", 0], "seed": "{{SEED}}", "steps": 4, "cfg": 1.0, "sampler_name": "euler", "scheduler": "simple",
                   "positive": ["22", 0], "negative": ["23", 0], "latent_image": ["24", 0], "denoise": 1.0},
    }
    wf["26"] = {"class_type": "VAEDecode", "inputs": {"samples": ["25", 0], "vae": ["3", 0]}}
    wf["27"] = {"class_type": "SaveImage", "inputs": {"images": ["26", 0], "filename_prefix": prefix}}
    return wf


def klein(images: list[str], prompt: str, prefix: str, canvas: bool = False, ref_megapixels: float = 1.0, fp16: bool = False) -> dict:
    """FLUX.2 klein 4B (distilled, 4 steps) with one ReferenceLatent per input image. ``canvas``: the
    output is an empty {{WIDTH}}×{{HEIGHT}} latent instead of the size of images[0]. ``fp16``: compute
    in fp16 although run.sh starts ComfyUI with --bf16-unet (which Qwen-Image needs: it overflows in
    fp16); bf16 is emulated on M1/M2 GPUs, and klein sampled 1.4x faster in fp16 with the same result."""
    wf: dict = {
        "1": {"class_type": "UnetLoaderGGUF", "inputs": {"unet_name": KLEIN["unet"]}},
        "2": {"class_type": "CLIPLoaderGGUF", "inputs": {"clip_name": KLEIN["clip"], "type": "flux2"}},
        "3": {"class_type": "VAELoader", "inputs": {"vae_name": KLEIN["vae"]}},
        "4": {"class_type": "CLIPTextEncode", "inputs": {"text": prompt, "clip": ["2", 0]}},
        "5": {"class_type": "ConditioningZeroOut", "inputs": {"conditioning": ["4", 0]}},
    }
    pos, neg = ["4", 0], ["5", 0]
    first_scaled = None
    for i, placeholder in enumerate(images):
        b = 10 + 5 * i
        wf[str(b)] = {"class_type": "LoadImage", "inputs": {"image": placeholder}}
        wf[str(b + 1)] = {"class_type": "ImageScaleToTotalPixels", "inputs": {"image": [str(b), 0], "upscale_method": "lanczos", "megapixels": ref_megapixels, "resolution_steps": 1}}
        wf[str(b + 2)] = {"class_type": "VAEEncode", "inputs": {"pixels": [str(b + 1), 0], "vae": ["3", 0]}}
        wf[str(b + 3)] = {"class_type": "ReferenceLatent", "inputs": {"conditioning": pos, "latent": [str(b + 2), 0]}}
        wf[str(b + 4)] = {"class_type": "ReferenceLatent", "inputs": {"conditioning": neg, "latent": [str(b + 2), 0]}}
        pos, neg = [str(b + 3), 0], [str(b + 4), 0]
        first_scaled = first_scaled or str(b + 1)
    if canvas:
        size = {"width": "{{WIDTH}}", "height": "{{HEIGHT}}"}
    else:
        wf["40"] = {"class_type": "GetImageSize", "inputs": {"image": [first_scaled, 0]}}
        size = {"width": ["40", 0], "height": ["40", 1]}
    wf["41"] = {"class_type": "EmptyFlux2LatentImage", "inputs": {**size, "batch_size": 1}}
    wf["42"] = {"class_type": "Flux2Scheduler", "inputs": {"steps": 4, **size}}
    model = ["1", 0]
    if fp16:
        wf["6"] = {"class_type": "ModelComputeDtype", "inputs": {"model": ["1", 0], "dtype": "fp16"}}
        model = ["6", 0]
    wf["43"] = {"class_type": "CFGGuider", "inputs": {"model": model, "positive": pos, "negative": neg, "cfg": 1.0}}
    wf["44"] = {"class_type": "RandomNoise", "inputs": {"noise_seed": "{{SEED}}"}}
    wf["45"] = {"class_type": "KSamplerSelect", "inputs": {"sampler_name": "euler"}}
    wf["46"] = {"class_type": "SamplerCustomAdvanced", "inputs": {"noise": ["44", 0], "guider": ["43", 0], "sampler": ["45", 0], "sigmas": ["42", 0], "latent_image": ["41", 0]}}
    wf["47"] = {"class_type": "VAEDecode", "inputs": {"samples": ["46", 0], "vae": ["3", 0]}}
    wf["48"] = {"class_type": "SaveImage", "inputs": {"images": ["47", 0], "filename_prefix": prefix}}
    return wf


# Only the items of this outfit, each with where it goes (the API writes "{{DESCRIPTION}}" as
# "bailarinas rosas con flores, on the feet; gorro de punto azul, on the head"). Listing generic
# examples ("hats on the head, bags in the hand…") made the model add hats, scarves and bags that
# were not in the outfit. The try-on service also pastes the result back only inside those body
# regions, so anything else the model changes is discarded.
ACCESSORIES_PROMPT = (
    "Image 1 is a photo of a person. Image 2 shows exactly these items: {{DESCRIPTION}}. Edit image 1 so the person "
    "wears these items, each where indicated, with their colours, materials and details exactly as in image 2. "
    "The listed items are the only change: keep the person's face, hair, body, pose, hands, all their clothes, the "
    "background and the lighting identical to image 1."
)

# Catalogue packshot: the whole instruction is built by the API per garment (services/api/src/
# modules/catalog-photo/prompt.ts) from the owner's base prompt + per-category instructions.
PACKSHOT_PROMPT = "{{PROMPT}}"

QWEN_META = {"model": "Qwen-Image-Edit-2511 (Q4_K_M) + Lightning 4 pasos", "license": "Apache-2.0"}
KLEIN_META = {"model": "FLUX.2 klein 4B (Q8_0)", "license": "Apache-2.0"}

WORKFLOWS = {
    # Catalogue photo: re-arranges the garment of the photo into a flat lay / ghost mannequin packshot.
    "packshot": (qwen(["{{INPUT_IMAGE}}"], PACKSHOT_PROMPT, "dressit_packshot", canvas=True), QWEN_META),
    "avatar": (qwen(["{{BODY_IMAGE}}", "{{OUTFIT_IMAGE}}", "{{FACE_IMAGE}}"], AVATAR_PROMPT, "dressit_avatar"), QWEN_META),
    # Last step of the sequential try-on: shoes and accessories (FASHN only dresses tops/bottoms/one-pieces).
    "tryon-accessories": (qwen(["{{BODY_IMAGE}}", "{{OUTFIT_IMAGE}}"], ACCESSORIES_PROMPT, "dressit_tryon_accessories"), QWEN_META),
    # Persistent avatar: another camera view of the user's studio avatar (fal Multiple-Angles LoRA, Apache-2.0).
    "avatar-view": (qwen(["{{BODY_IMAGE}}"], VIEW_PROMPT, "dressit_avatar_view", ANGLES_LORA), {"model": "Qwen-Image-Edit-2511 + Multiple-Angles LoRA", "license": "Apache-2.0"}),
    # Fast catalogue photo: FLUX.2 klein 4B distilled (4 steps), ~5x fewer weights than Qwen-Image-Edit.
    "packshot-fast": (klein(["{{INPUT_IMAGE}}"], PACKSHOT_PROMPT, "dressit_packshot_fast", canvas=True, ref_megapixels=0.5, fp16=True), {**KLEIN_META, "canvas": [832, 1040]}),
    "avatar-fast": (klein(["{{BODY_IMAGE}}", "{{OUTFIT_IMAGE}}", "{{FACE_IMAGE}}"], AVATAR_PROMPT, "dressit_avatar_fast"), KLEIN_META),
}

OUT.mkdir(parents=True, exist_ok=True)
for name, (wf, meta) in WORKFLOWS.items():
    (OUT / f"{name}.json").write_text(json.dumps(wf, indent=2, ensure_ascii=False) + "\n")
    (OUT / f"{name}.meta.json").write_text(json.dumps(meta, indent=2, ensure_ascii=False) + "\n")
    print("✓", name)
