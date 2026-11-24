Files in this folder are copied from FASHN VTON v1.5 (https://github.com/fashn-AI/fashn-vton-1.5,
Apache License 2.0, © FASHN AI; licence text in `LICENSE`): `tryon_mmdit.py`, `dwpose/`, `utils/`, `preprocessing/transforms.py`.

Changes by DressIt:
- `tryon_mmdit.py`: RoPE frequencies computed in float32 on Apple MPS (no float64 there).
- The original `pipeline.py` and `preprocessing/agnostic.py` are not included: they import
  `fashn-human-parser`, whose weights are under the NVIDIA SegFormer licence (research/evaluation
  only). DressIt does not use it:
  - garments are sent as flat-lay product photos, so the garment image is never parsed;
  - the person image is used as-is (segmentation-free) or, for the first garment of each body
    region, masked with DressIt's own clothing-agnostic mask built from Sapiens2 body-part parsing
    (`app/parsing.py::agnostic_mask`, written for DressIt — not derived from upstream's
    `agnostic.py`), applied in `app/runner.py`.

The model weights (`fashn-ai/fashn-vton-1.5`, Apache-2.0) and DWPose ONNX weights
(`fashn-ai/DWPose`, Apache-2.0) are downloaded by `services/tryon/setup.sh`.
