"""FASHN VTON v1.5 inference without the (non-commercial) human parser.

Mirrors ``fashn_vton.pipeline.TryOnPipeline.__call__`` for the case DressIt uses — garment given as
a product photo ("flat-lay") and ``segmentation_free=True`` — where the parser output is never read:
the person image is used as-is and the garment image is not masked.
"""

from __future__ import annotations

import logging
import os
import time
from dataclasses import dataclass
from typing import Callable, Literal

import cv2
import numpy as np
import torch
from PIL import Image

from .fashn.dwpose import DWposeDetector, draw_pose
from .fashn.preprocessing.transforms import AspectPreserveResize, ResizePad
from .fashn.tryon_mmdit import TryOnModel
from .fashn.utils import get_dummy_dw_keypoints, get_rf_schedule, load_checkpoint, normalize_uint8_to_neg1_1, numpy_to_torch, tensor_to_pil

MASK_VALUE = 127
Category = Literal["tops", "bottoms", "one-pieces"]
CATEGORY_TO_LABEL = {"tops": 1, "bottoms": 2, "one-pieces": 3}
log = logging.getLogger("tryon")


@dataclass
class TryOnResult:
    image: Image.Image
    timings_ms: dict[str, float]


def pick_device(requested: str | None = None) -> torch.device:
    if requested:
        return torch.device(requested)
    if torch.cuda.is_available():
        return torch.device("cuda")
    if torch.backends.mps.is_available():
        return torch.device("mps")
    return torch.device("cpu")


class FashnRunner:
    def __init__(self, weights_dir: str, dwpose_dir: str, device: str | None = None) -> None:
        self.device = pick_device(device)
        # bf16 on CUDA (as upstream); fp32 elsewhere (MPS bf16 is slow / fp16 overflows).
        self.dtype = torch.bfloat16 if self.device.type == "cuda" and torch.cuda.is_bf16_supported() else torch.float32
        t0 = time.perf_counter()
        self.model = TryOnModel()
        self.model.load_state_dict(load_checkpoint(os.path.join(weights_dir, "model.safetensors"), device="cpu"))
        self.model.to(self.device, dtype=self.dtype).eval()
        self.pose = DWposeDetector(checkpoints_dir=dwpose_dir, device=f"cuda:{self.device.index or 0}" if self.device.type == "cuda" else "cpu")
        h, w = self.model.input_shape
        self.pre_resize = AspectPreserveResize(target_size=(max(h, w), max(h, w)), mode="fit", backend="pil")
        self.resize_pad = ResizePad((w, h), backend="opencv")
        self.load_ms = round((time.perf_counter() - t0) * 1000, 1)
        log.info("FASHN VTON loaded on %s (%s) in %.0f ms", self.device, self.dtype, self.load_ms)

    @torch.inference_mode()
    def __call__(
        self,
        person: Image.Image,
        garment: Image.Image,
        category: Category,
        *,
        steps: int = 30,
        guidance: float = 1.5,
        seed: int = 42,
        mask_fn: Callable[[Image.Image, str], np.ndarray] | None = None,
    ) -> TryOnResult:
        """``mask_fn`` (optional) returns where to redraw on the (resized) person image: those pixels
        are greyed out like upstream's masked mode, so the old garment is replaced, not dressed over."""
        timings: dict[str, float] = {}
        t = time.perf_counter()
        torch.manual_seed(seed)
        np.random.seed(seed)
        person = self.pre_resize(person.convert("RGB"), allow_upsampling=False)
        garment = self.pre_resize(garment.convert("RGB"), allow_upsampling=False)
        p_np, g_np = np.array(person), np.array(garment)
        person_pose = self.pose(p_np[..., ::-1])
        p_pose = draw_pose(person_pose, p_np.shape[0], p_np.shape[1], grayscale=True)
        g_pose = draw_pose(get_dummy_dw_keypoints(), g_np.shape[0], g_np.shape[1], grayscale=True)
        timings["pose"] = round((time.perf_counter() - t) * 1000, 1)
        ca_np = p_np
        if mask_fn is not None:
            t = time.perf_counter()
            mask = mask_fn(person, category)
            if mask.any():
                ca_np = p_np.copy()
                ca_np[mask] = MASK_VALUE
            timings["mask"] = round((time.perf_counter() - t) * 1000, 1)

        def prep(img: np.ndarray, nearest: bool = False, mem: bool = False) -> torch.Tensor:
            img = self.resize_pad(img, mem_padding=True) if mem else self.resize_pad(img, interpolation=cv2.INTER_NEAREST_EXACT) if nearest else self.resize_pad(img)
            t = numpy_to_torch(img)
            if t.ndim == 2:  # grayscale pose maps: (H, W) → (1, H, W); upstream gets this from .repeat()
                t = t.unsqueeze(0)
            return normalize_uint8_to_neg1_1(t.unsqueeze(0)).to(self.device, dtype=self.dtype)

        kwargs = {
            "ca_images": prep(ca_np, mem=True),
            "garment_images": prep(g_np),
            "person_poses": prep(p_pose, nearest=True),
            "garment_poses": prep(g_pose, nearest=True),
            "garment_categories": torch.tensor([CATEGORY_TO_LABEL[category]], device=self.device),
        }
        t = time.perf_counter()
        c, h, w = self.model.channels_in, *self.model.input_shape
        x = torch.randn((1, c, h, w), dtype=self.dtype, device=self.device)
        ts = get_rf_schedule(num_steps=steps, mu=1.5)
        for i, (t_curr, t_prev) in enumerate(zip(ts[:-1], ts[1:])):
            tv = torch.full((1,), t_curr, dtype=self.dtype, device=self.device)
            pred = self.model.forward_for_cfg(x, tv, **kwargs)
            v = pred["v_c"] if i >= steps - 1 else pred["v_u"] + guidance * (pred["v_c"] - pred["v_u"])
            x = x + (t_prev - t_curr) * v
        if self.device.type == "mps":
            torch.mps.synchronize()
        timings["sampling"] = round((time.perf_counter() - t) * 1000, 1)
        out = tensor_to_pil(x[0].to(torch.float).clamp(-1, 1), unnormalize=True)
        return TryOnResult(image=self.resize_pad.unpad(out), timings_ms=timings)
