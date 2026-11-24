"""Typed access to ``vocabulary.json`` (exported from packages/shared; never edit by hand)."""

from __future__ import annotations

import json
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

VOCABULARY_PATH = Path(__file__).resolve().parent / "vocabulary.json"


@dataclass(frozen=True)
class Subcategory:
    id: str
    label: str
    category: str
    layer: str
    clo: float
    formality: float
    styles: dict[str, float]


@dataclass(frozen=True)
class ColorFamily:
    id: str
    label: str
    hex: str
    neutral: bool
    metallic: bool


@dataclass(frozen=True)
class Labeled:
    id: str
    label: str


@dataclass(frozen=True)
class Vocabulary:
    categories: tuple[str, ...]
    subcategories: tuple[Subcategory, ...]
    color_families: tuple[ColorFamily, ...]
    patterns: tuple[Labeled, ...]
    materials: tuple[Labeled, ...]
    styles: tuple[str, ...]
    seasons: tuple[str, ...]
    fits: tuple[str, ...]

    def subcategory(self, sub_id: str) -> Subcategory:
        for sub in self.subcategories:
            if sub.id == sub_id:
                return sub
        raise KeyError(sub_id)

    def subcategories_of(self, category: str) -> list[Subcategory]:
        return [s for s in self.subcategories if s.category == category]


def _labeled(items: list) -> tuple[Labeled, ...]:
    out: list[Labeled] = []
    for item in items:
        if isinstance(item, str):
            out.append(Labeled(id=item, label=item))
        else:
            out.append(Labeled(id=item["id"], label=item.get("label", item["id"])))
    return tuple(out)


def _ids(items: list) -> tuple[str, ...]:
    return tuple(item if isinstance(item, str) else item["id"] for item in items)


@lru_cache(maxsize=1)
def load_vocabulary(path: Path = VOCABULARY_PATH) -> Vocabulary:
    raw = json.loads(path.read_text(encoding="utf-8"))
    return Vocabulary(
        categories=_ids(raw["categories"]),
        subcategories=tuple(
            Subcategory(
                id=s["id"],
                label=s["label"],
                category=s["category"],
                layer=s.get("layer", ""),
                clo=float(s.get("clo", 0.0)),
                formality=float(s.get("formality", 50)),
                styles={k: float(v) for k, v in (s.get("styles") or {}).items()},
            )
            for s in raw["subcategories"]
        ),
        color_families=tuple(
            ColorFamily(
                id=c["id"],
                label=c.get("label", c["id"]),
                hex=c["hex"],
                neutral=bool(c.get("neutral", False)),
                metallic=bool(c.get("metallic", False)),
            )
            for c in raw["colorFamilies"]
        ),
        patterns=_labeled(raw["patterns"]),
        materials=_labeled(raw["materials"]),
        styles=_ids(raw["styles"]),
        seasons=_ids(raw["seasons"]),
        fits=_ids(raw["fits"]),
    )
