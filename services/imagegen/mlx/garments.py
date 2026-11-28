"""Garment detection by a vision-language model, as Alta does it: the model looks at the whole photo
and lists each garment or accessory as ONE item, however it looks (a tailcoat whose olive body and
black satin tails a box detector split in two; a hoodie mostly hidden on a person), with a box and a
shop-style description of the COMPLETE item, hidden parts included.

Pure functions (no MLX): the prompt and the clean-up of the model's answer, so they can be tested.
"""

from __future__ import annotations

import json
import re

CATEGORIES = {
    "top",
    "bottom",
    "one_piece",
    "outerwear",
    "footwear",
    "accessory",
    "swimwear",
}

GARMENTS_PROMPT = (
    'List the clothes and fashion accessories in this photo that belong to its main subject: what the '
    'main person wears (the largest, most central person) or the items laid out, hanging or displayed. '
    'Ignore other people in the background, body parts, furniture, bedding, rugs, walls, books, bottles '
    'and any other objects; ignore reflections in mirrors or glass and pictures of clothes. Each physical'
    ' item is ONE entry with ONE box that covers all of its visible part (not just its collar, cuff or a '
    'corner): a pair of shoes, socks or gloves is one entry with one box around both; a coat whose parts '
    'look different (a jacket body with long tails, a contrasting lining) is one entry; two different '
    'garments (a waistcoat and trousers) are two entries. Skip a heap of things where single items cannot'
    ' be told apart, and anything too small or too hidden to tell what it is. Include items that are only'
    ' partly visible or partly covered by others when you can tell what they are. Reply with JSON only: '
    '{"items": [{"bbox_2d": [x1, y1, x2, y2], "name": "<2-5 word English shop name with colour and type; '
    'plain colour words as it looks (tan or olive, never khaki)>", "name_es": "<the same name translated '
    'to Spanish from Spain (castellano; never Italian or Portuguese), as a shop in Spain writes it, e.g. '
    'Sudadera con capucha roja, Frac verde oliva, Vaqueros pitillo desgastados, Zapatillas altas rojas>",'
    ' "description": "<in English, one or two sentences describing the COMPLETE item as an online shop '
    'would: the exact type; its length (e.g. very short shorts ending at the top of the thigh, cropped '
    'jacket ending at the waist, knee-length skirt, ankle socks or knee-high socks); fit and shape '
    "(fitted, loose, flared, straight; how the front and back are cut, e.g. a tailcoat's short front and "
    'long tails); sleeve length; neckline, collar or hood; the colour of every part (body, sleeves, '
    'lining, collar, trims, sole); material and texture (knit, lace, sheer, denim, leather, suede, '
    'straw); closures, pockets, prints, logos and text. Describe the item alone, as it would look laid '
    'out by itself: never mention the person, body, hair, how or where it is worn, or other items. '
    'Mention only details you can actually see; say plain where there is no print or logo; for parts '
    'hidden in the photo give their most likely appearance>", "category": '
    '"<top|bottom|one_piece|outerwear|footwear|accessory|swimwear|not_clothing>", "length": "<clothes: '
    'cropped, waist, hip, upper-thigh, mid-thigh, knee, midi, ankle or full; anything else: n/a>", '
    '"sleeves": "<none, short, elbow or long; n/a for items that never have sleeves>", "hood": <true if '
    'it has a hood>, "laces": <true if it has laces>, "big_graphic_or_text": <true if it has a large '
    'print, graphic, picture or text; false if plain, patterned all over (checks, stripes, florals) or '
    'with only a small logo>, "lettering": <true if any letters, words or numbers are on it>, '
    '"sheer_or_lace": <true if the fabric is sheer, mesh or lace>, "hatband": '
    '<true if it is a hat with a band around the crown>, "tails": <true if it is a coat with long tails '
    'at the back, like a tailcoat>, "top_handle": <true if it is a bag with a short handle on top>, '
    '"worn": <true if a person is wearing or holding it in the photo; false if it is laid out, hanging or'
    ' displayed>, "colours": "<the main colour of each part, e.g. body beige; sleeves blue; collar '
    'blue>", "visible": "<whole if the complete item can be seen; partial if part of it is hidden: worn '
    'under or behind something, covered, folded or cut by the edge of the photo>"}]}'
)

# The fast try-on's check: does the person in the render wear each garment of the outfit? (klein
# sometimes keeps the person's own leggings instead of the skirt it was given.)
TRYON_CHECK_PROMPT = (
    "This photo shows a person. For each of these items, answer whether the person is clearly wearing it, "
    "in this order: {ITEMS}. An item the framing cannot show (shoes when the feet are out of the photo) "
    'counts as worn. Reply with JSON only: {"worn": [<true or false for each item, in order>]}'
)


def parse_worn(text: str, n: int) -> list[bool]:
    """The try-on check's answer → one bool per garment (missing answers count as worn)."""
    data = _json(text)
    worn = data.get("worn") if isinstance(data, dict) else data
    if not isinstance(worn, list):
        raise ValueError("no list in the try-on check answer")
    out = [v if isinstance(v, bool) else str(v).strip().lower() != "false" for v in worn[:n]]
    return out + [True] * (n - len(out))


SPANISH = re.compile(
    r"[áéíóúñ¿]|\b(camiseta|sudadera|pantal[oó]n(es)?|vaqueros?|chaqueta|cazadora|abrigo|vestido|falda|"
    r"zapat(o|os|illas)|calcet[ií]n(es)?|medias|bolso|gorr[oa]|sombrero|cintur[oó]n|bufanda|blusa|camisa|"
    r"chaleco|botas|botines|sandalias|mochila|cartera|guantes|negr[oa]s?|blanc[oa]s?|roj[oa]s?|azul(es)?|"
    r"verde|gris|marr[oó]n|beis|amarill[oa]s?|con|para|tiene|cuello|mangas?|bolsillos?)\b",
    re.IGNORECASE,
)


def looks_spanish(text: str) -> bool:
    """The model sometimes writes the English fields in Spanish ("Calcetines blancos"): the image
    editor does not understand it (it drew a white jumper for white knee socks)."""
    return bool(SPANISH.search(text or ""))


TRANSLATE_PROMPT = (
    "Translate this clothing item's shop name and description to English, keeping every detail. Reply with "
    'JSON only: {"name": "<2-5 word English shop name with colour and type>", "description": "<the description in English>"}\n'
    "Name: {NAME}\nDescription: {DESCRIPTION}"
)


PAIRED = re.compile(
    r"\b(shoe|sneaker|trainer|boot|heel|pump|sandal|loafer|flat|slipper|sock|glove|mitten|earring)s?\b"
)
# Fraction of the photo: smaller boxes cannot be rebuilt without inventing (a choker at 0.3 % and
# sunglasses on top of the head at 0.5 % came out as other jewellery and invented frames; a pearl
# necklace at 0.65 % was fine).
MIN_AREA = 0.006
# Things the model sometimes lists as "accessories" although they are not worn: a hanger on a rack, the
# poles and stuff sacks of a hiking kit, a mannequin, a reflection.
NOT_WORN = re.compile(
    r"\b(hangers?|trekking poles?|hiking poles?|walking poles?|poles?|stuff sacks?|compression sacks?|"
    r"bottles?|mannequins?|dress forms?|stands?|reflections?|knife|knives|tents?|towels?|pillows?|"
    r"blankets?|cushions?|rugs?|books?|phones?|laptops?)\b",
    re.IGNORECASE,
)
MAX_ITEMS = 12


def _json(text: str):
    for a, b in (("{", "}"), ("[", "]")):
        start, end = text.find(a), text.rfind(b)
        if start >= 0 and end > start:
            try:
                return json.loads(text[start : end + 1])
            except json.JSONDecodeError:
                continue
    # An answer cut off by the token limit: keep the items written in full.
    start = text.find("[")
    if start >= 0:
        for end in [i for i, ch in enumerate(text) if ch == "}" and i > start][::-1]:
            try:
                return {"items": json.loads(text[start : end + 1] + "]")}
            except json.JSONDecodeError:
                continue
    raise ValueError("no JSON in the VLM answer")


def _str(v: object, n: int) -> str:
    return "" if v is None else str(v).strip()[:n]


def _box(raw: object, scale: float) -> list[float] | None:
    if not isinstance(raw, (list, tuple)) or len(raw) != 4:
        return None
    try:
        x0, y0, x1, y1 = (float(v) / scale for v in raw)
    except (TypeError, ValueError):
        return None
    x0, x1 = sorted((max(0.0, min(1.0, x0)), max(0.0, min(1.0, x1))))
    y0, y1 = sorted((max(0.0, min(1.0, y0)), max(0.0, min(1.0, y1))))
    if x1 <= x0 or y1 <= y0:
        return None
    return [round(x0, 4), round(y0, 4), round(x1, 4), round(y1, 4)]


def _iou(a: list[float], b: list[float]) -> float:
    ix = max(0.0, min(a[2], b[2]) - max(a[0], b[0]))
    iy = max(0.0, min(a[3], b[3]) - max(a[1], b[1]))
    inter = ix * iy
    union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / union if union > 0 else 0.0


def _key(name: str) -> str:
    return re.sub(r"s\b", "", re.sub(r"[^a-z ]", "", name.lower())).strip()


LENGTHS = ["cropped", "waist", "hip", "upper-thigh", "mid-thigh", "knee", "midi", "ankle", "full"]
SLEEVES = ["none", "short", "elbow", "long"]
FLAGS = ("hood", "laces", "big_graphic_or_text", "lettering", "sheer_or_lace", "hatband", "tails", "top_handle", "worn")


def attributes_of(d: dict) -> dict:
    """What a catalogue photo must keep (length, sleeves, hood, laces, a large print, lace, a hatband, tails), as
    the model answered it; unknown values become n/a or false."""

    def flag(k: str) -> bool:
        v = d.get(k, False)
        return v if isinstance(v, bool) else str(v).strip().lower() == "true"

    length = _str(d.get("length"), 20).lower().replace(" ", "-")
    sleeves = _str(d.get("sleeves"), 10).lower()
    return {
        "kind": _str(d.get("kind") or d.get("name"), 60).lower(),
        "colours": _str(d.get("colours") or d.get("colors"), 160).lower(),
        "length": length if length in LENGTHS else "n/a",
        "sleeves": sleeves if sleeves in SLEEVES else "n/a",
        **{k: flag(k) for k in FLAGS},
    }


# A box that is only a thin strip along the photo's edge is the visible end of something the photo cuts
# off (the tops of two socks at the bottom edge): too little to rebuild the item from.
EDGE = 0.01
MIN_EDGE_DEPTH = 0.07


def _edge_sliver(b: list[float]) -> bool:
    x0, y0, x1, y1 = b
    return ((y1 >= 1 - EDGE or y0 <= EDGE) and y1 - y0 < MIN_EDGE_DEPTH) or (
        (x1 >= 1 - EDGE or x0 <= EDGE) and x1 - x0 < MIN_EDGE_DEPTH
    )


def _item_fields(it: dict) -> dict | None:
    """One item of the model's answer (without its box), or None when it is not clothing."""
    category = _str(it.get("category"), 20).lower()
    name = _str(it.get("name"), 80)
    if category not in CATEGORIES or not name or NOT_WORN.search(name):
        return None
    visible = _str(it.get("visible"), 10).lower()
    return {
        "name": name,
        "name_es": _str(it.get("name_es"), 80) or name,
        "description": _str(it.get("description"), 400) or name,
        "category": category,
        "visible": "partial" if visible == "partial" else "whole",
        "attributes": attributes_of(it),
    }


def clean_garments(text: str, scale: float = 1000.0) -> list[dict]:
    """The model's answer → items {box (0–1), name, name_es, description, category, visible}.

    Drops what is not clothing and boxes too small to be an item; joins the two halves of a pair the
    model listed separately (two "white high heels") into one box; drops a box that repeats another
    of the same category almost exactly. Qwen-VL boxes are on a 0–1000 grid (``scale``).
    """
    data = _json(text)
    raw = data.get("items", []) if isinstance(data, dict) else data
    if isinstance(data, dict) and "bbox_2d" in data:
        raw = [data]
    items: list[dict] = []
    for it in raw if isinstance(raw, list) else []:
        if not isinstance(it, dict):
            continue
        box = _box(it.get("bbox_2d") or it.get("box"), scale)
        fields = _item_fields(it)
        if box is None or fields is None:
            continue
        items.append({"box": box, **fields})
    # The two halves of a pair, listed as two items with the same name → one item.
    merged: list[dict] = []
    for it in items:
        twin = next(
            (
                m
                for m in merged
                if PAIRED.search(it["name"].lower())
                and _key(m["name"]) == _key(it["name"])
                and m["category"] == it["category"]
            ),
            None,
        )
        if twin is None:
            merged.append(it)
            continue
        a, b = twin["box"], it["box"]
        twin["box"] = [
            min(a[0], b[0]),
            min(a[1], b[1]),
            max(a[2], b[2]),
            max(a[3], b[3]),
        ]
    # The same item boxed twice; boxes too small to be an item (after joining pairs, so the two
    # halves of a small pair are not dropped before they are joined).
    out: list[dict] = []
    for it in merged:
        b = it["box"]
        if (b[2] - b[0]) * (b[3] - b[1]) < MIN_AREA or _edge_sliver(b):
            continue
        if any(
            o["category"] == it["category"] and _iou(o["box"], it["box"]) > 0.8
            for o in out
        ):
            continue
        out.append(it)
    return out[:MAX_ITEMS]

