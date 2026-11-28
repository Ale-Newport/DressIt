"""What a studio photo must keep from the user's photo, read by the vision-language model one image at a
time (comparing two images at once, it listed differences that were not there) and compared by rules:
length, sleeves, hood, laces, large prints or text, lace or sheer fabric, a hatband.

Pure functions (no MLX), tested in test_garments.py.
"""

from __future__ import annotations

import re

from garments import LENGTHS, _json, attributes_of

ATTRIBUTES_PROMPT = (
    "Look only at {TARGET}. Reply with JSON only: "
    '{"kind": "<2-4 word item type, e.g. denim shorts, slip-on pumps, puffer vest, knee-high socks, top hat>", '
    '"is_expected": <true if it is a {EXPECTED}; false if it is another kind of item>, '
    '"length": "<clothes: cropped, waist, hip, upper-thigh, mid-thigh, knee, midi, ankle or full; anything else: n/a>", '
    '"sleeves": "<none, short, elbow or long; n/a for items that never have sleeves>", '
    '"hood": <true if it has a hood>, '
    '"laces": <true if it has laces>, '
    '"big_graphic_or_text": <true if it has a large print, graphic, picture or text; false if plain, patterned all '
    "over (checks, stripes, florals) or with only a small logo>, "
    '"lettering": <true if any letters, words or numbers are on it>, '
    '"sheer_or_lace": <true if the fabric is sheer, mesh or lace>, '
    '"hatband": <true if it is a hat with a band around the crown>, '
    '"tails": <true if it is a coat with long tails at the back, like a tailcoat>, '
    '"top_handle": <true if it is a bag with a short handle on top>, '
    '"closed_feet": <true if it is tights, stockings or socks with closed feet (not footless leggings)>, '
    '"several_items": <true if the photo shows more than one garment, e.g. a jacket together with trousers>, '
    '"body_parts": <true if feet, legs, hands or any part of a person or mannequin can be seen>, '
    '"pair_differs": <true if it is a pair (shoes, socks, gloves) whose two items differ from each other: a buckle, '
    "strap, pattern or detail on one that the other lacks, or another colour or shape; false if they match or it is "
    "not a pair>, "
    '"colours": "<the main colour of each part, e.g. body beige; sleeves blue; collar blue>"}'
)
TARGET_MARKED = "the item inside the red rectangle (ignore everything else, including the person)"
TARGET_PRODUCT = "the item in this product photo"

def attributes_prompt(target: str, expected: str) -> str:
    return ATTRIBUTES_PROMPT.replace("{TARGET}", target).replace("{EXPECTED}", expected or "garment")


def parse_attributes(text: str) -> dict:
    d = _json(text)
    if not isinstance(d, dict):
        raise ValueError("no JSON object in the attributes answer")
    is_expected = d.get("is_expected", True)
    def flag(k: str, default: bool) -> bool:
        v = d.get(k, default)
        if isinstance(v, bool):
            return v
        word = str(v).strip().lower()
        return word != "false" if default else word == "true"

    return {
        **attributes_of(d),
        "is_expected": flag("is_expected", True),
        "several_items": flag("several_items", False),
        "closed_feet": flag("closed_feet", True),
        "body_parts": flag("body_parts", False),
        "pair_differs": flag("pair_differs", False),
    }


SHORTS = ("shorts", "hot pants", "short pants")
HOSIERY = ("tights", "stockings", "pantyhose", "hosiery")
# Height / width of shorts laid flat, front up (the cutout's box): the model cannot judge the length of
# shorts without a body (it called knee-length bermudas "mid-thigh"), the shape can. Very short shorts
# are wider than long (the legs splay from the waist); bermudas are clearly taller than wide.
MAX_SHORTS_ASPECT = {"upper-thigh": 0.95, "mid-thigh": 1.15}


def item_aspect(img) -> float | None:
    """Height / width of the item in a studio photo (a PIL image): from its alpha when it is a cutout,
    else from what differs from the background colour (its corners). None if nothing stands out."""
    from PIL import ImageChops

    if img.mode in ("RGBA", "LA"):
        mask = img.getchannel("A").point(lambda v: 255 if v > 32 else 0)
    else:
        rgb = img.convert("RGB")
        bg = rgb.getpixel((2, 2))
        diff = ImageChops.difference(rgb, __import__("PIL.Image", fromlist=["Image"]).new("RGB", rgb.size, bg)).convert("L")
        mask = diff.point(lambda v: 255 if v > 28 else 0)
    box = mask.getbbox()
    if not box:
        return None
    return (box[3] - box[1]) / max(1, box[2] - box[0])


# Colour words → families; neighbouring families (cream and beige, charcoal and black, navy and teal)
# are not told apart, so only a clearly different colour counts (blue sleeves drawn charcoal, grey ones red).
FAMILIES = {
    "black": "black", "charcoal": "black", "jet": "black",
    "grey": "grey", "gray": "grey", "silver": "grey", "heather": "grey",
    "white": "white", "ivory": "white", "cream": "white", "off-white": "white", "ecru": "white",
    "beige": "beige", "tan": "beige", "khaki": "beige", "camel": "beige", "sand": "beige", "taupe": "beige", "stone": "beige", "nude": "beige",
    "brown": "brown", "cognac": "brown", "chocolate": "brown", "mocha": "brown", "rust": "orange",
    "red": "red", "burgundy": "red", "maroon": "red", "crimson": "red", "wine": "red", "scarlet": "red",
    "pink": "pink", "rose": "pink", "fuchsia": "pink", "magenta": "pink", "blush": "pink",
    "orange": "orange", "coral": "orange", "terracotta": "orange", "peach": "orange",
    "yellow": "yellow", "mustard": "yellow", "gold": "yellow", "golden": "yellow",
    "green": "green", "olive": "green", "khaki-green": "green", "mint": "green", "sage": "green", "emerald": "green",
    "blue": "blue", "navy": "blue", "denim": "blue", "cobalt": "blue", "royal": "blue", "teal": "blue", "turquoise": "blue", "indigo": "blue", "sky": "blue",
    "purple": "purple", "lilac": "purple", "lavender": "purple", "violet": "purple", "plum": "purple",
}
NEAR = {frozenset(p) for p in (("black", "grey"), ("grey", "white"), ("white", "beige"), ("beige", "brown"), ("brown", "orange"),
                                ("orange", "red"), ("red", "pink"), ("pink", "purple"), ("purple", "blue"), ("blue", "green"),
                                ("green", "beige"), ("yellow", "beige"), ("yellow", "orange"))}


def colour_parts(text: str) -> dict[str, str]:
    """ "body beige; sleeves blue" → {"body": "beige", "sleeves": "blue"} (families; unknown words skipped)."""
    out: dict[str, str] = {}
    for chunk in re.split(r"[;,\n]", text or ""):
        words = re.findall(r"[a-z-]+", chunk.lower())
        if len(words) < 2:
            continue
        fam = next((FAMILIES[w] for w in reversed(words[1:]) if w in FAMILIES), None)
        if fam:
            out.setdefault(words[0], fam)
    return out


PAIRS = re.compile(r"\b(socks?|shoes?|sneakers?|trainers?|boots?|heels?|pumps?|loafers?|sandals?|flats?|gloves?|mittens?|earrings?|tights|stockings)\b")


def compare_attributes(
    original: dict, shown: dict, *, partial: bool, category: str, aspect: float | None = None, length_unseen: bool = False
) -> list[str]:
    """What the studio photo got wrong. A partly visible original only counts what can be seen: its
    hidden parts may be completed (a hood or a print the photo hides is no error when added).
    `aspect`: height / width of the item in the studio cutout, for the length of shorts.
    `length_unseen`: the photo cuts the item at the top or bottom, so its length is not compared."""
    partial_length = partial or length_unseen
    problems: list[str] = []
    if shown.get("is_expected") is False:
        problems.append(f"another kind of item: {shown['kind'] or 'unknown'}")
    clothes = category in ("top", "bottom", "one_piece", "outerwear", "swimwear")
    limit = MAX_SHORTS_ASPECT.get(original["length"])
    if limit and aspect and aspect > limit and not length_unseen and any(w in original["kind"] for w in SHORTS):
        problems.append(f"too long for {original['length']} shorts")
    if clothes and not partial_length and original["length"] != "n/a" and shown["length"] != "n/a":
        d = LENGTHS.index(shown["length"]) - LENGTHS.index(original["length"])
        # Two steps apart, or thigh length against knee length (very short shorts drawn as bermudas).
        thigh_knee = {original["length"], shown["length"]} in ({"upper-thigh", "knee"}, {"mid-thigh", "knee"})
        if abs(d) >= 2 or thigh_knee:
            problems.append(f"{'longer' if d > 0 else 'shorter'}: {shown['length']} instead of {original['length']}")
    if clothes and original["sleeves"] != "n/a" and shown["sleeves"] != "n/a" and original["sleeves"] != shown["sleeves"]:
        if "none" in (original["sleeves"], shown["sleeves"]) or {original["sleeves"], shown["sleeves"]} == {"short", "long"}:
            problems.append(f"{shown['sleeves']} sleeves instead of {original['sleeves']}")
    if original["hood"] and not shown["hood"]:
        problems.append("hood missing")
    if shown["hood"] and not original["hood"] and not partial:
        problems.append("hood added")
    if category == "footwear" and shown["laces"] and not original["laces"]:
        problems.append("laces added")
    if original["big_graphic_or_text"] != shown["big_graphic_or_text"] and not (partial and shown["big_graphic_or_text"]):
        problems.append("print or text added" if shown["big_graphic_or_text"] else "print or text missing")
    if original["sheer_or_lace"] and not shown["sheer_or_lace"]:
        problems.append("lace or sheer fabric missing")
    if shown["hatband"] and not original["hatband"]:
        problems.append("hatband added")
    if original.get("tails") and not shown.get("tails"):
        problems.append("tails missing")
    # A pair (socks, shoes, gloves) is one item, though the model counts two.
    if shown.get("several_items") and not PAIRS.search(original["kind"]) and category != "footwear":
        problems.append("other garments added")
    # Bags only (a wallet's wrist strap reads as a handle): klein puts a top handle on chain bags. A clutch
    # has none, whatever the detection said (held in the hand, it read as "a short handle").
    clutch = bool(re.search(r"\bclutch", original["kind"]))
    had_handle = original.get("top_handle") and not clutch
    if shown.get("top_handle") and not had_handle and category == "accessory" and ("bag" in original["kind"] or clutch):
        problems.append("top handle added")
    if any(w in original["kind"] for w in HOSIERY) and not shown.get("closed_feet", True):
        problems.append("feet missing")
    # klein draws invented gibberish where it adds letters; an item whose detection saw none keeps none
    # (also when partly seen). Old detections without the field are not judged.
    if original.get("lettering") is False and shown.get("lettering"):
        problems.append("text added")
    # Worn shoes and gloves came out with the legs (in the user's tights) or hands inside.
    if shown.get("body_parts") and category in ("footwear", "accessory"):
        problems.append("body parts shown")
    if shown.get("pair_differs") and (category == "footwear" or PAIRS.search(original["kind"])):
        problems.append("pair differs")
    want, got = colour_parts(original.get("colours", "")), colour_parts(shown.get("colours", ""))
    for part, fam in want.items():
        other = got.get(part)
        # Also for an item seen in part: its hidden parts follow the detection's description (a grey tee
        # under a red hoodie came out with red sleeves).
        if other and other != fam and frozenset((fam, other)) not in NEAR:
            problems.append(f"{part} {other} instead of {fam}")
    return problems


def fix_from(original: dict, problems: list[str], name: str) -> str:
    """How the item must look, in positive terms, from what the user's photo shows."""
    if not problems:
        return ""
    parts = [name]
    if any(p.startswith("another kind") for p in problems):
        parts.append(f"exactly a {original['kind']}, not any other kind of item")
    if any(p.startswith(("longer", "shorter")) for p in problems):
        parts.append(f"{original['length'].replace('-', ' ')} length")
    if any(p.startswith("too long for") for p in problems):
        parts.append(
            "very short hot pants with a 2-inch inseam, legs ending just below the crotch, wider than long"
            if original["length"] == "upper-thigh"
            else "short shorts with a 4-inch inseam ending at mid-thigh, about as long as they are wide"
        )
    if any(" sleeves instead of " in p for p in problems):
        parts.append("sleeveless" if original["sleeves"] == "none" else f"{original['sleeves']} sleeves")
    if "hood missing" in problems:
        parts.append("with its hood")
    if "hood added" in problems:
        parts.append("without a hood")
    if "laces added" in problems:
        parts.append("slip-on, without laces or eyelets")
    if "print or text added" in problems:
        parts.append("plain, without any print, graphic or text")
    if "print or text missing" in problems:
        parts.append("with its print or text")
    if "lace or sheer fabric missing" in problems:
        parts.append("in sheer lace fabric")
    if "hatband added" in problems:
        parts.append("without a hatband")
    if "tails missing" in problems:
        parts.append("with its two long tails hanging at the back")
    if "top handle added" in problems:
        parts.append("with only its own strap or chain, no short handle on top")
    if "feet missing" in problems:
        parts.append("with closed feet, not footless leggings")
    if "text added" in problems:
        parts.append("without any letters, words or numbers")
    if "body parts shown" in problems:
        parts.append("alone and empty, with no feet, legs, hands or tights in or around it")
    if "pair differs" in problems:
        parts.append("the two items of the pair identical, mirror images with the same details")
    # Colour problems ("sleeves grey instead of blue"): the part with the detection's own colour words.
    words = {c.split()[0]: c.strip() for c in re.split(r"[;,\n]", original.get("colours", "")) if len(c.split()) >= 2}
    colours = [words.get(p.split()[0], p.split()[0]) for p in problems if p.endswith(tuple(f"instead of {f}" for f in set(FAMILIES.values())))]
    if colours:
        parts.append("with " + ", ".join(colours))
    if "other garments added" in problems:
        parts.append(f"the {original['kind']} alone, without trousers or any other garment")
    return ", ".join(parts)
