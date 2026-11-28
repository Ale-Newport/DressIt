"""HTTP contract tests against the STUB backend (FastAPI TestClient)."""

from __future__ import annotations

import base64
import hashlib
import io
import json
import re

import numpy as np
import pytest
from PIL import Image

from .conftest import garment_image, jpeg_bytes, png_bytes

ITEM_KEYS = {
    "bbox",
    "cutout_png_base64",
    "mask_area_ratio",
    "detection_score",
    "category",
    "subcategory",
    "colors",
    "pattern",
    "materials",
    "styles",
    "seasons",
    "fit",
    "embedding",
    "embedding_model",
    "quality",
}


def _analyze(client, data: bytes, filename="x.png", **form):
    return client.post(
        "/v1/analyze",
        files={"file": (filename, data, "image/png")},
        data={k: str(v) for k, v in form.items()},
    )


def test_health_reports_stub(client):
    r = client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert (
        body["status"] == "ok" and body["backend"] == "stub" and body["device"] == "cpu"
    )
    assert body["models"] == {"stub": True} and body["version"]


def test_analyze_single_contract(client):
    data = png_bytes(garment_image())
    r = _analyze(client, data, mode="single")
    assert r.status_code == 200, r.text
    body = r.json()
    img = body["image"]
    assert (img["width"], img["height"]) == (480, 640)
    assert img["sha256"] == hashlib.sha256(data).hexdigest()
    assert (
        re.fullmatch(r"[0-9a-f]{16}", img["phash"]) and img["exif_transposed"] is False
    )
    assert len(body["items"]) == 1
    item = body["items"][0]
    assert ITEM_KEYS <= set(item)
    x0, y0, x1, y1 = item["bbox"]
    assert 0 <= x0 < x1 <= 1 and 0 <= y0 < y1 <= 1
    assert x0 == pytest.approx(0.15, abs=0.02) and y1 == pytest.approx(0.85, abs=0.02)
    cut = Image.open(io.BytesIO(base64.b64decode(item["cutout_png_base64"])))
    assert cut.format == "PNG" and cut.mode == "RGBA" and max(cut.size) <= 1024
    alpha = np.asarray(cut)[:, :, 3]
    assert (
        alpha[0, 0] == 0 and alpha.max() == 255
    )  # transparent padding, opaque garment
    assert 0.2 < item["mask_area_ratio"] < 0.4
    assert [c["family"] for c in item["colors"]] == [
        "rojo"
    ]  # background pixels excluded
    assert sum(c["share"] for c in item["colors"]) == pytest.approx(1.0, abs=1e-3)
    emb = np.array(item["embedding"])
    assert emb.shape == (768,) and np.linalg.norm(emb) == pytest.approx(1.0, abs=1e-3)
    assert item["embedding_model"].startswith("stub/")
    # The stub never invents attributes.
    for key in (
        "category",
        "subcategory",
        "pattern",
        "materials",
        "styles",
        "seasons",
        "fit",
    ):
        assert item[key] is None
    q = item["quality"]
    assert set(q) == {"blur", "brightness", "warnings"} and all(
        isinstance(w, str) for w in q["warnings"]
    )
    assert body["model_versions"]["backend"] == "stub"
    assert "total" in body["timings_ms"]


def test_exif_orientation_is_applied(client):
    img = Image.fromarray(garment_image(size=(400, 300)))  # 400 wide × 300 high
    exif = Image.Exif()
    exif[0x0112] = 6  # rotate 90° CW on display
    r = client.post(
        "/v1/analyze",
        files={"file": ("p.jpg", jpeg_bytes(img, exif=exif.tobytes()), "image/jpeg")},
    )
    assert r.status_code == 200, r.text
    info = r.json()["image"]
    assert info["exif_transposed"] is True and (info["width"], info["height"]) == (
        300,
        400,
    )


def test_analyze_multi_returns_each_object(client):
    arr = np.full((600, 900, 3), 240, np.uint8)
    arr[100:500, 80:380] = (31, 42, 68)  # navy item
    arr[150:450, 520:820] = (242, 209, 60)  # yellow item
    r = _analyze(client, png_bytes(arr), mode="multi", max_items=8)
    assert r.status_code == 200, r.text
    items = r.json()["items"]
    assert len(items) == 2
    fams = sorted(i["colors"][0]["family"] for i in items)
    assert fams == ["amarillo", "azul_marino"]
    assert all(i["detection_score"] is not None for i in items)
    r1 = _analyze(client, png_bytes(arr), mode="multi", max_items=1)
    assert len(r1.json()["items"]) == 1


def test_analyze_with_boxes_from_a_vision_language_model(client):
    """External boxes replace the detector: each one is segmented, kept in the caller's order and
    tagged with its index, even where the detector would have merged or dropped it."""
    arr = np.full((600, 900, 3), 240, np.uint8)
    arr[100:500, 80:380] = (31, 42, 68)
    arr[150:450, 520:820] = (242, 209, 60)
    boxes = [
        {"box": [520 / 900, 140 / 600, 830 / 900, 460 / 600], "category": "top"},
        {"box": [70 / 900, 90 / 600, 390 / 900, 510 / 600], "category": "bottom"},
    ]
    r = client.post(
        "/v1/analyze",
        files={"file": ("p.png", png_bytes(arr), "image/png")},
        data={"mode": "multi", "max_items": "8", "boxes": json.dumps(boxes)},
    )
    assert r.status_code == 200, r.text
    items = r.json()["items"]
    assert [i["box_index"] for i in items] == [0, 1]
    assert items[0]["colors"][0]["family"] == "amarillo"
    assert items[0]["bbox"][0] > 0.5 and items[1]["bbox"][2] < 0.5
    bad = client.post(
        "/v1/analyze",
        files={"file": ("p.png", png_bytes(arr), "image/png")},
        data={"mode": "multi", "boxes": json.dumps([{"box": [0, 0, 2, 1]}])},
    )
    assert bad.status_code == 422
    text = client.post(
        "/v1/analyze",
        files={"file": ("p.png", png_bytes(arr), "image/png")},
        data={"mode": "multi", "boxes": json.dumps([{"box": ["0", "0", "1", "1"]}])},
    )
    assert text.status_code == 422


def test_png_with_alpha_uses_existing_cutout(client):
    arr = np.zeros((300, 300, 4), np.uint8)
    arr[50:250, 100:200] = (47, 94, 168, 255)
    r = _analyze(client, png_bytes(arr))
    item = r.json()["items"][0]
    assert item["bbox"] == pytest.approx(
        [100 / 300, 50 / 300, 200 / 300, 250 / 300], abs=0.01
    )
    assert item["colors"][0]["family"] == "azul"


def test_validation_errors(client):
    data = png_bytes(garment_image())
    r = _analyze(client, data, mode="batch")
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_mode"
    r = _analyze(client, data, max_items=0)
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_max_items"
    r = _analyze(client, b"this is not an image", filename="x.txt")
    assert r.status_code == 415 and r.json()["error"]["code"] == "unsupported_image"
    big = b"\xff" * (15 * 1024 * 1024 + 10)
    r = _analyze(client, big)
    assert r.status_code == 413 and r.json()["error"]["code"] == "file_too_large"


def test_embed_image_and_text(client):
    r = client.post(
        "/v1/embed/image",
        files={"file": ("x.png", png_bytes(garment_image()), "image/png")},
    )
    assert r.status_code == 200
    body = r.json()
    assert (
        body["dim"] == 768
        and len(body["embedding"]) == 768
        and body["model"].startswith("stub/")
    )
    r = client.post("/v1/embed/text", json={"texts": ["chaqueta beige", "red dress"]})
    assert r.status_code == 200
    body = r.json()
    assert body["translated"] == ["beige jacket", "red dress"]
    emb = np.array(body["embeddings"])
    assert emb.shape == (2, 768) and np.allclose(
        np.linalg.norm(emb, axis=1), 1.0, atol=1e-3
    )
    assert client.post("/v1/embed/text", json={"texts": []}).status_code == 422


def test_ocr_stub(client):
    r = client.post(
        "/v1/ocr", files={"file": ("x.png", png_bytes(garment_image()), "image/png")}
    )
    assert r.status_code == 200
    assert r.json() == {"text": "", "lines": [], "model": "stub"}


def test_confident_embedding_produces_attributes(client, monkeypatch):
    """When the image embedding matches a class prototype, the same pipeline emits values."""
    from app.config import get_settings
    from app.models import get_backend
    from app.pipeline.classify import get_heads

    backend = get_backend()
    heads = get_heads(backend, get_settings())
    proto = heads.garment.prototypes[heads.garment.ids.index("vaquero")]
    monkeypatch.setattr(
        backend, "embed_images", lambda imgs: np.tile(proto, (len(imgs), 1))
    )
    monkeypatch.setattr(
        heads.garment, "scale", 400.0
    )  # make the stub's random prototypes decisive
    r = _analyze(client, png_bytes(garment_image(color=(75, 101, 132))))
    item = r.json()["items"][0]
    assert item["category"]["value"] == "bottom"
    assert item["subcategory"]["value"] == "vaquero"
    assert "denim" in item["materials"]["value"]


def test_heic_upload(client):
    pillow_heif = pytest.importorskip("pillow_heif")
    buf = io.BytesIO()
    pillow_heif.from_pillow(Image.fromarray(garment_image())).save(buf, quality=90)
    r = client.post(
        "/v1/analyze", files={"file": ("x.heic", buf.getvalue(), "image/heic")}
    )
    assert r.status_code == 200, r.text
    assert r.json()["items"][0]["colors"][0]["family"] == "rojo"


def test_analyze_can_keep_pixels_untouched(client):
    """Studio photos made by the image generator skip the WB/exposure normalisation."""
    import base64
    import io

    import numpy as np
    from PIL import Image

    data = png_bytes(garment_image())

    def cut(r):
        return np.asarray(
            Image.open(
                io.BytesIO(base64.b64decode(r.json()["items"][0]["cutout_png_base64"]))
            ).convert("RGBA")
        )

    normalised = _analyze(client, data, mode="single")
    raw = _analyze(client, data, mode="single", normalize="false")
    assert raw.status_code == 200, raw.text
    assert cut(raw).shape[2] == 4 and cut(normalised).shape == cut(raw).shape


def test_compare_endpoint(client):
    import io

    from PIL import Image, ImageDraw

    img = Image.new("RGBA", (200, 260), (0, 0, 0, 0))
    ImageDraw.Draw(img).rectangle((30, 30, 170, 230), fill=(120, 80, 60, 255))
    buf = io.BytesIO()
    img.save(buf, "PNG")
    data = buf.getvalue()
    r = client.post(
        "/v1/compare",
        files={
            "reference": ("a.png", data, "image/png"),
            "candidate": ("b.png", data, "image/png"),
        },
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["passed"] is True and body["shape_iou"] > 0.99 and body["reasons"] == []
    bad = client.post(
        "/v1/compare",
        files={
            "reference": ("a.png", data, "image/png"),
            "candidate": ("b.png", b"not an image", "image/png"),
        },
    )
    assert bad.status_code in (400, 415, 422)


def test_segment_with_points_contract(client):
    import json

    data = png_bytes(garment_image())
    ok = client.post(
        "/v1/segment/points",
        files={"file": ("p.png", data, "image/png")},
        data={"points": json.dumps([[0.5, 0.5, 1], [0.05, 0.05, 0]])},
    )
    assert ok.status_code == 200, ok.text
    body = ok.json()
    assert (
        body["cutout_png_base64"]
        and len(body["bbox"]) == 4
        and 0 < body["mask_area_ratio"] < 1
    )
    no_positive = client.post(
        "/v1/segment/points",
        files={"file": ("p.png", data, "image/png")},
        data={"points": json.dumps([[0.5, 0.5, 0]])},
    )
    assert (
        no_positive.status_code == 422
        and "prenda" in no_positive.json()["error"]["message"]
    )
    outside = client.post(
        "/v1/segment/points",
        files={"file": ("p.png", data, "image/png")},
        data={"points": json.dumps([[1.5, 0.5, 1]])},
    )
    assert outside.status_code == 422


def test_matte_contract(client):
    r = client.post(
        "/v1/matte", files={"file": ("p.png", png_bytes(garment_image()), "image/png")}
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["png_base64"] and 0 < body["coverage"] < 1 and body["width"] == 480
