"""Fit the softmax scales (1/temperature) of the zero-shot heads on the *calib* split.

Uses the item embeddings cached by ``scripts/evaluate.py`` (``eval/out/embeddings.npz``)
and the manifest labels. For the garment head the objective is the NLL of the
acceptable subcategory set plus the NLL of the category marginal; for the pattern
head the NLL of the acceptable pattern set. Heads without labels (material,
style, warmth, fit, scene) inherit the garment scale. Writes ``app/calibration.json``
and prints accuracy/coverage per threshold to choose the abstention thresholds.

    uv run python scripts/evaluate.py && uv run python scripts/calibrate.py && uv run python scripts/evaluate.py
"""

from __future__ import annotations

import csv
import json
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import numpy as np  # noqa: E402

from app.config import get_settings  # noqa: E402
from app.models import get_backend  # noqa: E402
from app.pipeline.classify import CALIBRATION_PATH, get_heads  # noqa: E402

GRID = np.arange(10.0, 201.0, 2.5)


def softmax(x: np.ndarray) -> np.ndarray:
    x = x - x.max(axis=1, keepdims=True)
    e = np.exp(x)
    return e / e.sum(axis=1, keepdims=True)


def main() -> int:
    cache = np.load(ROOT / "eval" / "out" / "embeddings.npz")
    emb_by_id = dict(zip(cache["ids"].tolist(), cache["emb"]))
    rows = [r for r in csv.DictReader((ROOT / "eval" / "manifest.csv").open(encoding="utf-8")) if r["id"] in emb_by_id]
    heads = get_heads(get_backend(), get_settings())
    vocab = heads.vocab
    sub_ids = [s.id for s in vocab.subcategories]
    sub_cat = np.array([s.category for s in vocab.subcategories])
    cats = list(dict.fromkeys(sub_cat))

    def garment_nll(scale: float, sel: list[dict]) -> float:
        E = np.stack([emb_by_id[r["id"]] for r in sel])
        P = softmax(scale * E @ heads.garment.prototypes.T)
        nll = 0.0
        for p, r in zip(P, sel):
            ok = [sub_ids.index(s) for s in r["subcategory"].split("|") if s]
            nll -= np.log(max(p[ok].sum(), 1e-12))
            nll -= np.log(max(p[: len(sub_ids)][sub_cat == r["category"]].sum(), 1e-12))
        return nll / len(sel)

    def pattern_nll(scale: float, sel: list[dict]) -> float:
        E = np.stack([emb_by_id[r["id"]] for r in sel])
        P = softmax(scale * E @ heads.pattern.prototypes.T)
        return float(np.mean([-np.log(max(p[[heads.pattern.ids.index(x) for x in r["pattern"].split("|")]].sum(), 1e-12)) for p, r in zip(P, sel)]))

    calib = [r for r in rows if r["split"] == "calib" and r["mode"] == "single" and r["subcategory"]]
    calib_pat = [r for r in calib if r["pattern"]]
    g_scale = float(min(GRID, key=lambda s: garment_nll(s, calib)))
    p_scale = float(min(GRID, key=lambda s: pattern_nll(s, calib_pat))) if calib_pat else g_scale
    print(f"garment scale={g_scale} (NLL {garment_nll(g_scale, calib):.3f}, n={len(calib)}); "
          f"pattern scale={p_scale} (NLL {pattern_nll(p_scale, calib_pat):.3f}, n={len(calib_pat)})")

    # Accuracy / coverage per threshold on the calib split, with the fitted scale.
    E = np.stack([emb_by_id[r["id"]] for r in calib])
    P = softmax(g_scale * E @ heads.garment.prototypes.T)[:, : len(sub_ids)]
    print("threshold  cat_cov cat_acc  sub_cov sub_acc")
    for t in (0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.7):
        cat_ans = cat_ok = sub_ans = sub_ok = 0
        for p, r in zip(P, calib):
            pc = np.array([p[sub_cat == c].sum() for c in cats])
            c = cats[int(np.argmax(pc))]
            if pc.max() >= t:
                cat_ans += 1
                cat_ok += c == r["category"]
            j = int(np.argmax(np.where(sub_cat == c, p, -1)))
            if p[j] >= t:
                sub_ans += 1
                sub_ok += sub_ids[j] in r["subcategory"].split("|")
        n = len(calib)
        print(f"  {t:.2f}     {cat_ans / n:.2f}    {cat_ok / max(cat_ans, 1):.2f}     {sub_ans / n:.2f}    {sub_ok / max(sub_ans, 1):.2f}")

    if calib_pat:
        Ep = np.stack([emb_by_id[r["id"]] for r in calib_pat])
        Pp = softmax(p_scale * Ep @ heads.pattern.prototypes.T)
        print("threshold  pattern_cov pattern_acc")
        for t in (0.4, 0.5, 0.55, 0.6, 0.7, 0.8):
            ans = [(p, r) for p, r in zip(Pp, calib_pat) if p.max() >= t]
            ok = sum(heads.pattern.ids[int(np.argmax(p))] in r["pattern"].split("|") for p, r in ans)
            print(f"  {t:.2f}       {len(ans) / len(calib_pat):.2f}        {ok / max(len(ans), 1):.2f}")

    data = {
        "scales": {"garment": g_scale, "pattern": p_scale, "material": g_scale, "style": g_scale,
                   "warmth": g_scale, "fit": g_scale, "scene": g_scale},
        "fitted_on": f"eval/manifest.csv split=calib (n={len(calib)} garments, {len(calib_pat)} with pattern labels)",
        "method": "grid search of softmax scale minimising NLL (acceptable-label sets); unlabeled heads inherit the garment scale",
        "date": date.today().isoformat(),
    }
    CALIBRATION_PATH.write_text(json.dumps(data, indent=2) + "\n")
    print(f"wrote {CALIBRATION_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
