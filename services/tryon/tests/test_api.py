"""Contract tests that don't need the model weights."""

import io

from fastapi.testclient import TestClient
from PIL import Image

from app.main import _flat_lay, app

client = TestClient(app)


def png(color=(200, 30, 30, 255), mode="RGBA") -> bytes:
    buf = io.BytesIO()
    Image.new(mode, (64, 80), color).save(buf, "PNG")
    return buf.getvalue()


def test_health_lists_models():
    body = client.get("/health").json()
    assert body["status"] == "ok" and set(body["models"]) == {"fashn-vton-1.5", "dwpose", "sapiens2-seg-0.4b"}


def test_rejects_unknown_category_and_bad_images():
    r = client.post("/v1/tryon", files={"person": ("p.png", png(), "image/png"), "garment": ("g.png", png(), "image/png")}, data={"category": "shoes"})
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_category"
    r = client.post("/v1/tryon", files={"person": ("p.png", b"nope", "image/png"), "garment": ("g.png", png(), "image/png")}, data={"category": "tops"})
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_image"
    r = client.post("/v1/tryon", files={"person": ("p.png", png(), "image/png"), "garment": ("g.png", png(), "image/png")}, data={"category": "tops", "steps": "200"})
    assert r.status_code == 422


def test_flat_lay_puts_transparent_cutouts_on_white():
    img = Image.new("RGBA", (10, 10), (0, 0, 0, 0))
    assert _flat_lay(img).getpixel((5, 5)) == (255, 255, 255)


def test_agnostic_mask_replaces_the_right_half_and_keeps_face_and_hands():
    import numpy as np

    from app.parsing import agnostic_mask

    # A toy person: hair/face on top, a jacket (23) with arms (11), trousers (13), hands (6), shoes (9).
    labels = np.zeros((200, 100), np.int64)
    labels[0:20, 40:60] = 4
    labels[20:40, 40:60] = 3
    labels[40:110, 30:70] = 23
    labels[40:100, 20:30] = 11
    labels[100:110, 20:30] = 6
    labels[110:185, 35:65] = 13
    labels[185:200, 35:65] = 9
    tops = agnostic_mask(labels, "tops")
    assert tops[60, 50] and tops[60, 25]  # jacket and arm are redrawn
    assert not tops[30, 50] and not tops[105, 25]  # face and hand are kept
    assert not tops[150, 50]  # trousers are kept
    bottoms = agnostic_mask(labels, "bottoms")
    assert bottoms[150, 50] and not bottoms[60, 50] and not bottoms[190, 50]  # trousers only, not jacket or shoes
    assert not agnostic_mask(np.zeros((50, 50), np.int64), "tops").any()


def test_extras_region_only_lets_the_feet_change_for_shoes():
    import numpy as np
    from PIL import Image

    from app.parsing import extras_region, paste_region

    labels = np.zeros((200, 100), np.int64)
    labels[10:25, 40:60] = 4  # hair
    labels[25:45, 40:60] = 3  # face
    labels[45:120, 30:70] = 23  # top
    labels[120:185, 35:65] = 13  # trousers
    labels[185:198, 35:65] = 9  # shoes
    edited_labels = labels.copy()
    edited_labels[5:15, 30:70] = 1  # the generator added a hat
    feet = extras_region(labels, edited_labels, "feet")
    assert feet[190, 50] and not feet[60, 50] and not feet[35, 50] and not feet[8, 50]
    head = extras_region(labels, edited_labels, "head")
    assert head[8, 50] and not head[35, 50] and not head[150, 50]
    base = Image.new("RGB", (100, 200), (10, 10, 10))
    edited = Image.new("RGB", (100, 200), (250, 250, 250))
    out = np.asarray(paste_region(base, edited, feet))
    assert out[193, 50, 0] > 200 and out[60, 50, 0] == 10  # new shoes kept, everything else untouched
    assert not extras_region(np.zeros((50, 50), np.int64), np.zeros((50, 50), np.int64), "feet").any()


def test_composite_rejects_unknown_regions():
    r = client.post("/v1/composite", files={"base": ("b.png", png(), "image/png"), "edited": ("e.png", png(), "image/png")}, data={"regions": "bag"})
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_regions"
