"""Real backend: FashionSigLIP (open_clip) + rembg + Grounding DINO / OWLv2 + SAM 2.1 + EasyOCR.

Every model is loaded lazily on first use, exactly once (double-checked lock),
and kept in memory. Inference on each model is serialised by its own lock
(PyTorch MPS and onnxruntime sessions are not guaranteed re-entrant), so
concurrent requests are safe and different stages of different requests can
overlap.
"""

from __future__ import annotations

import logging
import threading
import time
from importlib import metadata
from pathlib import Path
from typing import Any, Callable, Sequence

import numpy as np
from PIL import Image

from ..config import Settings
from .base import Detection, OcrLine

log = logging.getLogger("vision.models")

SAM_MODEL_ID = "facebook/sam2.1-hiera-small"


def resolve_device(requested: str) -> str:
    import torch

    if requested not in {"auto", ""}:
        return requested
    if torch.cuda.is_available():
        return "cuda"
    if torch.backends.mps.is_available():
        return "mps"
    return "cpu"


def _hf_revision(repo_id: str) -> str:
    """Commit hash of the cached snapshot (reads ``refs/main`` of the HF cache; no network)."""
    try:
        from huggingface_hub.constants import HF_HUB_CACHE

        ref = (
            Path(HF_HUB_CACHE)
            / f"models--{repo_id.replace('/', '--')}"
            / "refs"
            / "main"
        )
        return ref.read_text().strip()[:12]
    except Exception:
        return "unknown"


def _pkg_version(name: str) -> str:
    try:
        return metadata.version(name)
    except metadata.PackageNotFoundError:
        return "unknown"


class _Lazy:
    """Thread-safe lazy singleton holder with its own inference lock."""

    def __init__(self, name: str, factory: Callable[[], Any]) -> None:
        self.name = name
        self._factory = factory
        self._value: Any = None
        self._load_lock = threading.Lock()
        self.run_lock = threading.Lock()
        self.load_seconds: float | None = None

    @property
    def loaded(self) -> bool:
        return self._value is not None

    def get(self) -> Any:
        if self._value is None:
            with self._load_lock:
                if self._value is None:
                    t0 = time.perf_counter()
                    self._value = self._factory()
                    self.load_seconds = time.perf_counter() - t0
                    log.info("loaded %s in %.1fs", self.name, self.load_seconds)
        return self._value


class TorchBackend:
    name = "torch"
    embedding_dim = 768

    def __init__(self, settings: Settings) -> None:
        import torch

        self.settings = settings
        self.device = resolve_device(settings.device)
        self.embedding_model_id = settings.embedding_model
        self.segmenter_name = settings.segmenter
        self.detector_id = settings.detector_model
        torch.set_grad_enabled(False)
        self._clip = _Lazy("embedding", self._load_clip)
        self._rembg = _Lazy("background_removal", self._load_rembg)
        self._studio = _Lazy("studio_matte", self._load_studio_matte)
        self._detector = _Lazy("detector", self._load_detector)
        self._sam = _Lazy("box_segmentation", self._load_sam)
        self._ocr = _Lazy("ocr", self._load_ocr)
        self._versions: dict[str, str] | None = None

    # ------------------------------------------------------------------ loaders
    def _load_clip(self) -> tuple[Any, Any, Any]:
        import open_clip

        model, _, preprocess = open_clip.create_model_and_transforms(
            f"hf-hub:{self.embedding_model_id}"
        )
        tokenizer = open_clip.get_tokenizer(f"hf-hub:{self.embedding_model_id}")
        model = model.to(self.device).eval()
        return model, preprocess, tokenizer

    def _load_rembg(self) -> Any:
        return self._rembg_session(self.segmenter_name)

    def _load_studio_matte(self) -> Any:
        # CPU only: onnxruntime's CoreML provider hangs compiling BiRefNet (seen on macOS 27,
        # onnxruntime CoreMLExecutionProvider::Compile never returns). The lite model takes ~3.5 s on CPU.
        return self._rembg_session(self.settings.studio_matte, coreml=False)

    def _rembg_session(self, name: str, *, coreml: bool = True) -> Any:
        import onnxruntime as ort
        from rembg import new_session

        providers: list[Any] = ["CPUExecutionProvider"]
        if (
            coreml
            and self.settings.onnx_coreml
            and "CoreMLExecutionProvider" in ort.get_available_providers()
        ):
            # Apple Silicon: ~3x faster than CPU. The compiled CoreML model is cached on disk,
            # otherwise every process start pays ~12 s of compilation.
            cache = self.settings.models_cache / "rembg" / "coreml_cache"
            cache.mkdir(parents=True, exist_ok=True)
            providers.insert(
                0, ("CoreMLExecutionProvider", {"ModelCacheDirectory": str(cache)})
            )
        # Model name is ALWAYS explicit: rembg's default (bria-rmbg) is non-commercial.
        return new_session(name, providers=providers)

    def _load_detector(self) -> tuple[Any, Any]:
        from transformers import AutoModelForZeroShotObjectDetection, AutoProcessor

        processor = AutoProcessor.from_pretrained(self.detector_id)
        model = (
            AutoModelForZeroShotObjectDetection.from_pretrained(self.detector_id)
            .to(self.device)
            .eval()
        )
        return processor, model

    def _load_sam(self) -> tuple[Any, Any]:
        from transformers import Sam2Model, Sam2Processor

        processor = Sam2Processor.from_pretrained(SAM_MODEL_ID)
        model = Sam2Model.from_pretrained(SAM_MODEL_ID).to(self.device).eval()
        return processor, model

    def _load_ocr(self) -> Any:
        from ..ocr import EasyOcrEngine

        return EasyOcrEngine(self.settings.ocr_languages, gpu=self.device == "cuda")

    # --------------------------------------------------------------- embeddings
    def embed_images(self, images: Sequence[Image.Image]) -> np.ndarray:
        import torch

        if not images:
            return np.zeros((0, self.embedding_dim), np.float32)
        model, preprocess, _ = self._clip.get()
        batch = torch.stack([preprocess(img.convert("RGB")) for img in images]).to(
            self.device
        )
        with self._clip.run_lock, torch.inference_mode():
            feats = model.encode_image(batch, normalize=True)
        return feats.float().cpu().numpy().astype(np.float32)

    def embed_texts(self, texts: Sequence[str]) -> np.ndarray:
        import torch

        if not texts:
            return np.zeros((0, self.embedding_dim), np.float32)
        model, _, tokenizer = self._clip.get()
        out = []
        for i in range(0, len(texts), 128):
            tokens = tokenizer(list(texts[i : i + 128])).to(self.device)
            with self._clip.run_lock, torch.inference_mode():
                out.append(
                    model.encode_text(tokens, normalize=True).float().cpu().numpy()
                )
        return np.concatenate(out).astype(np.float32)

    # ------------------------------------------------------------- segmentation
    def remove_background(self, image: Image.Image) -> np.ndarray:
        session = self._rembg.get()
        with self._rembg.run_lock:
            masks = session.predict(image.convert("RGB"))
        mask = masks[0]
        if mask.size != image.size:
            mask = mask.resize(image.size, Image.Resampling.BILINEAR)
        return np.asarray(mask, dtype=np.float32) / 255.0

    def matte_studio(self, image: Image.Image) -> np.ndarray:
        session = self._studio.get()
        with self._studio.run_lock:
            masks = session.predict(image.convert("RGB"))
        mask = masks[0]
        if mask.size != image.size:
            mask = mask.resize(image.size, Image.Resampling.BILINEAR)
        return np.asarray(mask, dtype=np.float32) / 255.0

    def segment_boxes(
        self, image: Image.Image, boxes: Sequence[tuple[float, float, float, float]]
    ) -> list[np.ndarray]:
        import torch

        if not boxes:
            return []
        processor, model = self._sam.get()
        inputs = processor(
            images=image.convert("RGB"),
            input_boxes=[[list(map(float, b)) for b in boxes]],
            return_tensors="pt",
        )
        inputs = {
            k: (v.to(self.device) if hasattr(v, "to") else v) for k, v in inputs.items()
        }
        with self._sam.run_lock, torch.inference_mode():
            outputs = model(**inputs, multimask_output=False)
        masks = processor.post_process_masks(
            outputs.pred_masks.cpu(), inputs["original_sizes"].cpu(), binarize=False
        )[0]
        # (num_boxes, 1, H, W) logits → probabilities
        probs = torch.sigmoid(masks.float()).numpy()
        return [probs[i, 0].astype(np.float32) for i in range(probs.shape[0])]

    def segment_points(
        self,
        image: Image.Image,
        points: Sequence[tuple[float, float, int]],
        box: tuple[float, float, float, float] | None = None,
    ) -> np.ndarray:
        import torch

        processor, model = self._sam.get()
        kwargs: dict[str, Any] = {
            "input_points": [[[[float(x), float(y)] for x, y, _ in points]]],
            "input_labels": [[[int(lbl) for _, _, lbl in points]]],
        }
        if box is not None:
            kwargs["input_boxes"] = [[list(map(float, box))]]
        inputs = processor(images=image.convert("RGB"), return_tensors="pt", **kwargs)
        inputs = {
            k: (v.to(self.device) if hasattr(v, "to") else v) for k, v in inputs.items()
        }
        with self._sam.run_lock, torch.inference_mode():
            outputs = model(**inputs, multimask_output=False)
        masks = processor.post_process_masks(
            outputs.pred_masks.cpu(), inputs["original_sizes"].cpu(), binarize=False
        )[0]
        return (
            torch.sigmoid(masks.float())
            .numpy()
            .reshape(-1, *masks.shape[-2:])[0]
            .astype(np.float32)
        )

    # ---------------------------------------------------------------- detection
    def detect(
        self,
        image: Image.Image,
        queries: Sequence[str],
        threshold: float,
        *,
        short_side: int | None = None,
    ) -> list[Detection]:
        import torch

        processor, model = self._detector.get()
        img = image.convert("RGB")
        w, h = img.size
        is_owl = "owl" in self.detector_id.lower()
        if is_owl:
            inputs = processor(text=[list(queries)], images=img, return_tensors="pt")
        else:
            prompt = ". ".join(q.lower() for q in queries) + "."
            # Grounding DINO's default input is 800 px (shortest side); a smaller one is ~2x faster.
            size = (
                {"shortest_edge": short_side, "longest_edge": int(short_side * 5 / 3)}
                if short_side
                else None
            )
            inputs = processor(
                images=img,
                text=prompt,
                return_tensors="pt",
                **({"size": size} if size else {}),
            )
        inputs = {
            k: (v.to(self.device) if hasattr(v, "to") else v) for k, v in inputs.items()
        }
        with self._detector.run_lock, torch.inference_mode():
            outputs = model(**inputs)
        outputs = _to_cpu(outputs)
        if is_owl:
            side = max(w, h)  # OWLv2 pads to a square at bottom/right
            res = processor.post_process_grounded_object_detection(
                outputs,
                threshold=threshold,
                target_sizes=torch.tensor([[side, side]]),
                text_labels=[list(queries)],
            )[0]
        else:
            res = processor.post_process_grounded_object_detection(
                outputs,
                inputs["input_ids"].cpu(),
                threshold=threshold,
                text_threshold=threshold,
                target_sizes=torch.tensor([[h, w]]),
            )[0]
        labels = res.get("text_labels") or res.get("labels") or []
        out: list[Detection] = []
        for box, score, label in zip(
            res["boxes"].tolist(), res["scores"].tolist(), labels
        ):
            x0, y0, x1, y1 = box
            x0, x1 = max(0.0, min(x0, w)), max(0.0, min(x1, w))
            y0, y1 = max(0.0, min(y0, h)), max(0.0, min(y1, h))
            if x1 - x0 < 2 or y1 - y0 < 2:
                continue
            out.append(
                Detection(box=(x0, y0, x1, y1), score=float(score), label=str(label))
            )
        return out

    # ---------------------------------------------------------------------- OCR
    def ocr(self, image: Image.Image) -> list[OcrLine]:
        engine = self._ocr.get()
        with self._ocr.run_lock:
            return engine.read(image)

    # ----------------------------------------------------------------- metadata
    def models_status(self) -> dict[str, bool]:
        return {
            self.embedding_model_id: self._clip.loaded,
            f"rembg:{self.segmenter_name}": self._rembg.loaded,
            f"rembg:{self.settings.studio_matte}": self._studio.loaded,
            self.detector_id: self._detector.loaded,
            SAM_MODEL_ID: self._sam.loaded,
            "easyocr": self._ocr.loaded,
        }

    def model_versions(self) -> dict[str, str]:
        if self._versions is not None:
            return self._versions
        versions = {
            "backend": "torch",
            "embedding": f"{self.embedding_model_id}@{_hf_revision(self.embedding_model_id)}",
            "background_removal": f"rembg {_pkg_version('rembg')}:{self.segmenter_name}",
            "studio_matte": f"rembg {_pkg_version('rembg')}:{self.settings.studio_matte}",
            "detector": f"{self.detector_id}@{_hf_revision(self.detector_id)}",
            "box_segmentation": f"{SAM_MODEL_ID}@{_hf_revision(SAM_MODEL_ID)}",
            "torch": _pkg_version("torch"),
            "open_clip": _pkg_version("open-clip-torch"),
            "transformers": _pkg_version("transformers"),
        }
        if "unknown" not in "".join(versions.values()):
            self._versions = versions  # all revisions resolved → freeze
        return versions

    def warmup(self, *, all_models: bool = False) -> None:
        """Load the embedding model (and optionally the rest) before serving traffic."""
        self._clip.get()
        if all_models:
            self._rembg.get()
            self._detector.get()
            self._sam.get()


def _to_cpu(outputs: Any) -> Any:
    for key, value in list(outputs.items()):
        if hasattr(value, "cpu"):
            outputs[key] = value.cpu()
    return outputs
