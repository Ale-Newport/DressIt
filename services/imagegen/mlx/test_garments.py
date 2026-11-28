"""Tests for the garment list clean-up (no model needed):

services/imagegen/.mflux-venv/bin/python -m pytest services/imagegen/mlx/test_garments.py
"""

import json

import pytest
from attrs import compare_attributes, fix_from, item_aspect, parse_attributes
from garments import GARMENTS_PROMPT, clean_garments, looks_spanish, parse_worn


def answer(items) -> str:
    return "```json\n" + json.dumps({"items": items}) + "\n```"


def item(name, box, category="top", **kw):
    return {
        "bbox_2d": box,
        "name": name,
        "description": f"a {name}",
        "category": category,
        **kw,
    }


def test_each_item_comes_with_what_its_catalogue_photo_must_keep():
    out = clean_garments(answer([item("denim shorts", [0, 0, 500, 500], "bottom", length="upper thigh", sleeves="none", laces="false", hood=True)]))
    assert out[0]["attributes"] == {"colours": "", "kind": "denim shorts", "length": "upper-thigh", "sleeves": "none", "hood": True,
                                    "laces": False, "big_graphic_or_text": False, "lettering": False, "sheer_or_lace": False, "hatband": False,
                                    "tails": False, "top_handle": False, "worn": False}
    assert '"length": "<clothes: cropped' in GARMENTS_PROMPT and '"hatband"' in GARMENTS_PROMPT


def test_one_entry_per_physical_item_is_asked_for():
    assert "a pair of shoes, socks or gloves is one entry" in GARMENTS_PROMPT
    assert "jacket body with long tails" in GARMENTS_PROMPT
    assert "Ignore other people in the background" in GARMENTS_PROMPT


def test_boxes_are_normalised_and_non_clothing_dropped():
    out = clean_garments(
        answer(
            [
                item(
                    "red hoodie",
                    [33, 1, 900, 999],
                    "outerwear",
                    name_es="Sudadera roja",
                    visible="partial",
                ),
                item("red book", [319, 0, 643, 152], "not_clothing"),
                item("speck", [10, 10, 12, 12], "accessory"),
                item("", [0, 0, 500, 500]),
                item("cap", "not a box", "accessory"),
            ]
        )
    )
    assert out == [
        {
            "box": [0.033, 0.001, 0.9, 0.999],
            "name": "red hoodie",
            "name_es": "Sudadera roja",
            "description": "a red hoodie",
            "category": "outerwear",
            "visible": "partial",
            "attributes": {"colours": "", "kind": "red hoodie", "length": "n/a", "sleeves": "n/a", "hood": False, "laces": False,
                           "big_graphic_or_text": False, "lettering": False, "sheer_or_lace": False, "hatband": False, "tails": False,
                           "top_handle": False, "worn": False},
        }
    ]


def test_the_two_halves_of_a_pair_become_one_item_but_distinct_bags_do_not():
    out = clean_garments(
        answer(
            [
                item("white high heels", [325, 819, 391, 891], "footwear"),
                item("white high heel", [400, 820, 470, 900], "footwear"),
                item("quilted shoulder bag", [156, 153, 762, 493], "accessory"),
                item("quilted shoulder bag", [32, 365, 700, 760], "accessory"),
            ]
        )
    )
    assert [o["name"] for o in out] == [
        "white high heels",
        "quilted shoulder bag",
        "quilted shoulder bag",
    ]
    assert out[0]["box"] == [0.325, 0.819, 0.47, 0.9]


def test_the_same_item_boxed_twice_is_kept_once_and_a_bare_list_is_accepted():
    text = json.dumps(
        [
            item("jeans", [100, 100, 500, 900], "bottom"),
            item("blue jeans", [105, 100, 505, 905], "bottom"),
            item("tee", [100, 100, 500, 900]),
        ]
    )
    assert [o["name"] for o in clean_garments(text)] == ["jeans", "tee"]


def test_no_json_is_an_error():
    with pytest.raises(ValueError):
        clean_garments("I cannot see any clothes.")


def test_an_answer_cut_off_by_the_token_limit_keeps_the_complete_items():
    text = (
        '```json\n{"items": ['
        + json.dumps(item("red hoodie", [33, 1, 900, 999], "top"))
        + ', {"bbox_2d": [10, 10, 50'
    )
    assert [o["name"] for o in clean_garments(text)] == ["red hoodie"]


def test_things_that_are_not_worn_are_dropped():
    out = clean_garments(
        answer(
            [
                item("Grey hanger", [0, 0, 300, 300], "accessory"),
                item("Hiking pole", [0, 300, 300, 900], "accessory"),
                item("Blue stuff sack", [300, 0, 500, 200], "accessory"),
                item("Green backpack", [500, 0, 900, 500], "accessory"),
                item("Black hooded vest", [100, 100, 600, 700], "outerwear"),
            ]
        )
    )
    assert [o["name"] for o in out] == ["Green backpack", "Black hooded vest"]


def test_english_fields_written_in_spanish_are_spotted():
    assert looks_spanish("Calcetines blancos")
    assert looks_spanish("Sudadera roja con forro gris")
    assert looks_spanish("Chaqueta de cuero de color marrón con un corte clásico")
    assert not looks_spanish("White knee-high socks")
    assert not looks_spanish("Red pullover hoodie with a grey lined hood and a kangaroo pocket")
    assert not looks_spanish("Tan corduroy wide leg pants, plain, no logo")


def test_two_small_halves_of_a_pair_are_joined_before_the_size_filter():
    out = clean_garments(
        answer(
            [
                item("black ankle sock", [500, 500, 550, 560], "accessory"),
                item("black ankle sock", [570, 500, 620, 560], "accessory"),
            ]
        )
    )
    # each half is 0.3 % of the photo, below MIN_AREA; joined they are 0.72 %
    assert len(out) == 1 and out[0]["box"] == [0.5, 0.5, 0.62, 0.56]


def attrs(**kw):
    base = {"colours": "", "kind": "shorts", "length": "mid-thigh", "sleeves": "n/a", "hood": False, "laces": False,
            "big_graphic_or_text": False, "lettering": False, "sheer_or_lace": False, "hatband": False, "tails": False, "top_handle": False, "worn": False, "is_expected": True}
    return {**base, **kw}


def test_attributes_are_parsed_with_unknown_values_as_not_applicable():
    a = parse_attributes(
        '{"kind": "Denim Shorts", "length": "upper thigh", "sleeves": "sleeveless", "hood": "false", '
        '"laces": true, "big_graphic_or_text": false}'
    )
    assert a == {"colours": "", "kind": "denim shorts", "length": "upper-thigh", "sleeves": "n/a", "hood": False, "laces": True,
                 "big_graphic_or_text": False, "lettering": False, "sheer_or_lace": False, "hatband": False, "tails": False,
                 "top_handle": False, "worn": False, "is_expected": True, "several_items": False, "closed_feet": True,
                 "body_parts": False, "pair_differs": False}


def test_rules_catch_length_sleeves_hood_laces_prints_lace_and_hatbands():
    assert compare_attributes(attrs(), attrs(length="knee"), partial=False, category="bottom") == [
        "longer: knee instead of mid-thigh"
    ]
    assert compare_attributes(attrs(), attrs(length="upper-thigh"), partial=False, category="bottom") == []
    vest, jacket = attrs(kind="puffer vest", length="hip", sleeves="none"), attrs(kind="puffer jacket", length="hip", sleeves="long")
    assert compare_attributes(vest, jacket, partial=False, category="outerwear") == ["long sleeves instead of none"]
    hoodie = attrs(kind="hoodie", length="hip", sleeves="long", hood=True)
    assert compare_attributes(hoodie, {**hoodie, "hood": False}, partial=True, category="top") == ["hood missing"]
    pumps = attrs(kind="pumps", length="n/a")
    assert compare_attributes(pumps, {**pumps, "laces": True}, partial=False, category="footwear") == ["laces added"]
    assert compare_attributes(attrs(), attrs(big_graphic_or_text=True), partial=False, category="top") == ["print or text added"]
    # Seen in part, a print may be hidden: adding one is not an error; the length is not compared either.
    assert compare_attributes(attrs(), attrs(big_graphic_or_text=True, length="knee"), partial=True, category="top") == []
    tights = attrs(kind="lace tights", length="full", sheer_or_lace=True)
    assert compare_attributes(tights, {**tights, "sheer_or_lace": False}, partial=False, category="bottom") == ["lace or sheer fabric missing"]
    hat = attrs(kind="straw hat", length="n/a")
    assert compare_attributes(hat, {**hat, "hatband": True}, partial=False, category="accessory") == ["hatband added"]


def test_the_fix_says_how_it_must_look():
    assert fix_from(attrs(length="upper-thigh"), ["longer: knee instead of upper-thigh"], "blue denim shorts") == (
        "blue denim shorts, upper thigh length"
    )
    assert fix_from(attrs(), [], "x") == ""
    assert fix_from(attrs(kind="pumps"), ["laces added"], "white pumps") == "white pumps, slip-on, without laces or eyelets"


def test_another_kind_and_long_shorts_are_caught():
    tail = attrs(kind="green and black tailcoat", length="full", sleeves="long")
    coat = {**tail, "kind": "long coat", "is_expected": False}
    assert compare_attributes(tail, coat, partial=False, category="outerwear") == ["another kind of item: long coat"]
    assert "exactly a green and black tailcoat" in fix_from(tail, ["another kind of item: long coat"], "tailcoat")
    short = attrs(kind="blue denim shorts", length="upper-thigh")
    # The model reads knee-length bermudas as "mid-thigh": the cutout's shape tells.
    assert compare_attributes(short, attrs(length="mid-thigh"), partial=False, category="bottom", aspect=1.3) == [
        "too long for upper-thigh shorts"
    ]
    assert compare_attributes(short, attrs(length="mid-thigh"), partial=False, category="bottom", aspect=0.8) == []
    assert "2-inch inseam" in fix_from(short, ["too long for upper-thigh shorts"], "blue denim shorts")


def test_the_item_shape_comes_from_the_alpha_or_the_background():
    from PIL import Image

    cut = Image.new("RGBA", (100, 100), (0, 0, 0, 0))
    cut.paste((20, 40, 200, 255), (10, 20, 60, 50))  # 50 wide, 30 tall
    assert abs(item_aspect(cut) - 0.6) < 1e-6
    photo = Image.new("RGB", (100, 100), (236, 236, 236))
    photo.paste((20, 40, 200), (40, 10, 60, 90))  # 20 wide, 80 tall
    assert abs(item_aspect(photo) - 4.0) < 1e-6
    assert item_aspect(Image.new("RGB", (10, 10), (236, 236, 236))) is None


def test_a_tailcoat_drawn_as_a_suit_is_caught():
    tail = attrs(kind="green and black tailcoat", length="full", sleeves="long", tails=True)
    suit = {**tail, "tails": False, "several_items": True}
    assert compare_attributes(tail, suit, partial=False, category="outerwear") == ["tails missing", "other garments added"]
    fix = fix_from(tail, ["tails missing", "other garments added"], "tailcoat")
    assert "two long tails" in fix and "without trousers" in fix


def test_bags_keep_their_handles_and_tights_their_feet():
    bag = attrs(kind="white quilted chain bag", length="n/a")
    assert compare_attributes(bag, {**bag, "top_handle": True}, partial=False, category="accessory") == ["top handle added"]
    # A clutch held in the hand was detected "with a handle": it has none.
    clutch = attrs(kind="floral clutch", length="n/a", top_handle=True)
    assert compare_attributes(clutch, {**clutch, "top_handle": True}, partial=False, category="accessory") == ["top handle added"]
    tights = attrs(kind="dark blue opaque tights", length="full")
    assert compare_attributes(tights, {**tights, "closed_feet": False}, partial=False, category="bottom") == ["feet missing"]
    assert "closed feet" in fix_from(tights, ["feet missing"], "navy tights")


def test_invented_text_legs_in_shoes_and_odd_pairs_are_caught():
    tee = attrs(kind="black graphic t-shirt", big_graphic_or_text=True, lettering=False)
    assert compare_attributes(tee, {**tee, "lettering": True}, partial=True, category="top") == ["text added"]
    # A detection made before the field existed says nothing about text: not judged.
    old = {k: v for k, v in tee.items() if k != "lettering"}
    assert compare_attributes(old, {**tee, "lettering": True}, partial=True, category="top") == []
    heels = attrs(kind="black pointed-toe heels", length="n/a", sleeves="n/a")
    assert compare_attributes(heels, {**heels, "body_parts": True}, partial=False, category="footwear") == ["body parts shown"]
    # A ghost-mannequin dress is never judged for body parts (the mannequin is the presentation).
    dress = attrs(kind="floral dress")
    assert compare_attributes(dress, {**dress, "body_parts": True}, partial=False, category="one_piece") == []
    loafers = attrs(kind="blue buckle loafers", length="n/a", sleeves="n/a")
    assert compare_attributes(loafers, {**loafers, "pair_differs": True}, partial=False, category="footwear") == ["pair differs"]
    fix = fix_from(heels, ["body parts shown", "pair differs", "text added"], "black heels")
    assert "no feet, legs" in fix and "mirror images" in fix and "without any letters" in fix


def test_the_try_on_check_reads_one_answer_per_garment():
    assert parse_worn('{"worn": [true, false, "true"]}', 3) == [True, False, True]
    assert parse_worn('```json\n{"worn": [false]}\n```', 3) == [False, True, True]  # missing → worn
    with pytest.raises(ValueError):
        parse_worn("yes", 2)


def test_a_pair_is_one_item_and_a_length_cut_by_the_photo_is_not_compared():
    socks = attrs(kind="white socks", length="ankle")
    assert compare_attributes(socks, {**socks, "several_items": True}, partial=False, category="accessory") == []
    coat = attrs(kind="tan trench coat", length="hip", sleeves="long")
    long = {**coat, "length": "knee", "hood": True}
    # Framed at the hips: the length is not judged, an invented hood still is.
    assert compare_attributes(coat, long, partial=False, category="outerwear", length_unseen=True) == ["hood added"]


def test_a_clearly_different_colour_of_a_part_is_caught_but_close_shades_are_not():
    tee = attrs(kind="raglan t-shirt", length="waist", sleeves="short", colours="body beige; sleeves blue; collar blue")
    drawn = {**tee, "colours": "body cream; sleeves charcoal grey; collar dark grey"}
    problems = compare_attributes(tee, drawn, partial=False, category="top")
    assert problems == ["sleeves grey instead of blue", "collar grey instead of blue"]
    assert fix_from(tee, problems, "raglan t-shirt") == "raglan t-shirt, with sleeves blue, collar blue"
    assert compare_attributes(tee, {**tee, "colours": "body ivory; sleeves navy; collar royal blue"}, partial=False, category="top") == []
    # Seen in part, its hidden sleeves still follow the description (they came out red from the hoodie over it).
    under = attrs(kind="grey t-shirt", sleeves="short", colours="body grey; sleeves grey")
    assert compare_attributes(under, {**under, "colours": "body grey; sleeves red"}, partial=True, category="top") == ["sleeves red instead of grey"]


def test_only_a_cutout_in_one_piece_is_restored():
    from PIL import Image

    from restore import usable_cutout

    whole = Image.new("RGBA", (100, 100), (0, 0, 0, 0))
    whole.paste((200, 0, 0, 255), (10, 10, 90, 90))
    assert usable_cutout(whole)
    broken = whole.copy()
    broken.paste((0, 0, 0, 0), (10, 45, 90, 55))  # cut in two halves
    assert not usable_cutout(broken)
    assert not usable_cutout(Image.new("RGBA", (10, 10), (0, 0, 0, 0)))


def test_a_thin_strip_along_the_photo_edge_is_dropped():
    def item(box, name):
        return {"bbox_2d": box, "name": name, "category": "accessory", "visible": "partial"}
    text = json.dumps({"items": [
        item([283, 942, 594, 1000], "black socks"),       # 5.8 % high at the bottom edge: a fragment
        item([200, 880, 560, 1000], "black boots"),       # 12 % high at the edge: kept
        item([300, 500, 700, 540], "brown belt"),         # thin but not at an edge: kept
    ]})
    assert [g["name"] for g in clean_garments(text)] == ["black boots", "brown belt"]

