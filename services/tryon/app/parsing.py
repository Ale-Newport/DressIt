"""Sapiens2 body-part parsing (facebook/sapiens2-seg-0.4b, Sapiens2 License) for try-on evaluation
and the fidelity gate: where the upper clothing, lower clothing, shoes and face are in an image."""

from __future__ import annotations

from functools import lru_cache

import numpy as np
import torch
from PIL import Image

REGIONS = {
    "upper": (1, 23),  # Apparel, Upper_Clothing
    "lower": (13,),  # Lower_Clothing
    "shoes": (9, 18),  # Left_Shoe, Right_Shoe
    "face": (3, 4),  # Face_Neck, Hair
}


# Sapiens2 (Goliath, 28 classes) ids used to build the clothing-agnostic image.
ARMS = (7, 11, 16, 20)  # lower/upper arms, both sides
LEGS = (8, 12, 17, 21)  # lower/upper legs, both sides
TORSO = (22,)
HANDS = (6, 15)
SHOES = (9, 18)
HEAD = (2, 3, 4, 24, 25, 26, 27, 28)  # glasses, face/neck, hair, lips, teeth, tongue
UPPER_CLOTHES = (1, 23)
LOWER_CLOTHES = (13,)
MASK_VALUE = 127  # FASHN's grey for masked regions


@lru_cache(maxsize=1)
def _model(path: str, device: str):
    from transformers import AutoImageProcessor, Sapiens2ForSemanticSegmentation

    proc = AutoImageProcessor.from_pretrained(path)
    model = Sapiens2ForSemanticSegmentation.from_pretrained(path).to(device).eval()
    return proc, model


def parse(image: Image.Image, model_path: str, device: str = "mps") -> np.ndarray:
    """Per-pixel class ids (H, W) at the image's size."""
    proc, model = _model(model_path, device)
    inputs = proc(images=image.convert("RGB"), return_tensors="pt").to(device)
    with torch.inference_mode():
        logits = model(**inputs).logits
    up = torch.nn.functional.interpolate(logits.float(), size=(image.height, image.width), mode="bilinear", align_corners=False)
    return up.argmax(1)[0].cpu().numpy()


def region_mask(labels: np.ndarray, region: str) -> np.ndarray:
    return np.isin(labels, REGIONS[region])


def crop_region(image: Image.Image, mask: np.ndarray, pad: int = 8) -> Image.Image | None:
    """RGBA crop of the region (transparent elsewhere), or None if it's too small."""
    if mask.sum() < 400:
        return None
    ys, xs = np.nonzero(mask)
    x0, x1, y0, y1 = max(0, xs.min() - pad), min(image.width, xs.max() + pad), max(0, ys.min() - pad), min(image.height, ys.max() + pad)
    rgba = image.convert("RGBA")
    a = np.zeros((image.height, image.width), np.uint8)
    a[mask] = 255
    rgba.putalpha(Image.fromarray(a))
    return rgba.crop((x0, y0, x1, y1))


def agnostic_mask(labels: np.ndarray, category: str) -> np.ndarray:
    """Where FASHN must redraw (bool, H×W): the clothes being replaced plus the skin they may
    cover (arms/torso for tops, legs for bottoms), grown so a bulkier old garment disappears
    completely — never over the face, hair, hands or the clothes of the other half of the body.

    Replaces FASHN's own parser (fashn-human-parser, non-commercial licence) with Sapiens2.
    """
    import cv2

    if category == "tops":
        target, keep = UPPER_CLOTHES + ARMS + TORSO, HEAD + HANDS + LOWER_CLOTHES + LEGS + SHOES
    elif category == "bottoms":
        target, keep = LOWER_CLOTHES + LEGS, HEAD + HANDS + UPPER_CLOTHES + ARMS + TORSO + SHOES
    else:  # one-pieces
        target, keep = UPPER_CLOTHES + LOWER_CLOTHES + ARMS + TORSO + LEGS, HEAD + HANDS + SHOES
    base = np.isin(labels, target).astype(np.uint8)
    if base.sum() == 0:
        return base.astype(bool)
    h = labels.shape[0]
    # Close small gaps (belt, folds) and grow the region: the new garment may be wider or longer.
    k = max(3, int(h * 0.012)) | 1
    closed = cv2.morphologyEx(base, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k * 3, k * 3)))
    grown = cv2.dilate(closed, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k * 2 + 1, k * 2 + 1)))
    return (grown > 0) & ~np.isin(labels, keep)


FEET = (5, 14, 10, 19) + SHOES  # feet, socks, shoes
HAIR = (4,)
FACE_NECK = (3,)
EXTRA_REGIONS = ("feet", "head", "neck")


def _band(shape: tuple[int, int], y0: int, y1: int, x0: int, x1: int) -> np.ndarray:
    out = np.zeros(shape, bool)
    out[max(0, y0) : max(0, y1), max(0, x0) : max(0, x1)] = True
    return out


def extras_region(base: np.ndarray, edited: np.ndarray, region: str) -> np.ndarray:
    """Where an extras pass (shoes, a hat, a scarf) may change the image, from the Sapiens2 labels of
    the image before (``base``) and after (``edited``) the edit, at the same size. Everything outside
    is taken from ``base``, so whatever the generator changed elsewhere is discarded."""
    import cv2

    h, w = base.shape
    grow = lambda m, f: cv2.dilate(m.astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (max(3, int(h * f)) | 1,) * 2)) > 0  # noqa: E731
    person = np.isin(base, tuple(range(1, 29)))
    if not person.any():
        return np.zeros((h, w), bool)
    ys, xs = np.nonzero(person)
    top, bottom, left, right = ys.min(), ys.max(), xs.min(), xs.max()
    face = np.isin(base, FACE_NECK)
    if region == "feet":
        return grow(np.isin(base, FEET) | np.isin(edited, FEET), 0.03)
    if region == "head":
        if not face.any():
            return np.zeros((h, w), bool)
        fy = np.nonzero(face)[0]
        chin = int(np.percentile(fy, 60))
        hat = (np.isin(edited, UPPER_CLOTHES + HAIR) | np.isin(base, HAIR)) & (np.arange(h)[:, None] < chin)
        above = _band((h, w), top - int(h * 0.12), top + int(h * 0.02), left, right)
        keep_face = face & np.isin(edited, FACE_NECK)  # the face stays the person's own
        return (grow(hat, 0.02) | above) & ~keep_face
    if region == "neck":
        if not face.any():
            return np.zeros((h, w), bool)
        fy, fx = np.nonzero(face)
        chin = int(np.percentile(fy, 70))
        band = _band((h, w), chin, chin + int((bottom - top) * 0.2), fx.min() - int(w * 0.08), fx.max() + int(w * 0.08))
        return grow(band & (np.isin(edited, UPPER_CLOTHES + FACE_NECK) | np.isin(base, UPPER_CLOTHES + FACE_NECK)), 0.015) & ~(face & np.isin(edited, FACE_NECK) & (np.arange(h)[:, None] < chin))
    raise ValueError(region)


def paste_region(base: Image.Image, edited: Image.Image, mask: np.ndarray, feather: float = 0.006) -> Image.Image:
    """``base`` with ``edited`` blended in inside ``mask`` (soft edge)."""
    import cv2

    a = cv2.GaussianBlur(mask.astype(np.float32), (0, 0), max(1.0, base.height * feather))[..., None]
    out = np.asarray(edited.convert("RGB"), np.float32) * a + np.asarray(base.convert("RGB"), np.float32) * (1 - a)
    return Image.fromarray(out.clip(0, 255).astype(np.uint8))
