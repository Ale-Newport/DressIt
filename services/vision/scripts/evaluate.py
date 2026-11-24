"""Evaluate the real pipeline over ``eval/manifest.csv``.

Reports, per split (calib / test / all):
* single-garment photos: accuracy, coverage (1 − abstain rate) and forced top-1
  accuracy for category, subcategory, primary colour family and pattern;
* multi-garment photos: category-level recall / precision of detected items;
* Spanish text→image retrieval (R@1, R@5, MRR) with and without query translation;
* latency p50 / p95 (warm, models already loaded) and median per-stage timings.

Writes ``eval/out/results.json``, ``eval/out/embeddings.npz`` (used by
``scripts/calibrate.py``) and ``eval/out/cutouts.jpg`` (visual check).

    uv run python scripts/evaluate.py
"""

from __future__ import annotations

import argparse
import base64
import csv
import io
import json
import platform
import statistics
import subprocess
import sys
import time
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import numpy as np  # noqa: E402
from PIL import Image, ImageDraw  # noqa: E402

from app.config import VERSION, get_settings  # noqa: E402
from app.models import get_backend  # noqa: E402
from app.pipeline.analyze import analyze_image  # noqa: E402
from app.pipeline.classify import get_heads  # noqa: E402
from app.pipeline.search import embed_text_queries  # noqa: E402
from app.vocabulary import load_vocabulary  # noqa: E402

OUT = ROOT / "eval" / "out"


def accept(value: str | None, gold: str) -> bool:
    return value is not None and value in gold.split("|")


def pct(n: int, d: int) -> float | None:
    return round(n / d, 3) if d else None


def machine_info(backend) -> dict[str, str]:
    info = {"python": platform.python_version(), "platform": platform.platform(), "device": backend.device}
    try:
        info["cpu"] = subprocess.run(["sysctl", "-n", "machdep.cpu.brand_string"], capture_output=True, text=True).stdout.strip()
        mem = int(subprocess.run(["sysctl", "-n", "hw.memsize"], capture_output=True, text=True).stdout.strip())
        info["memory_gb"] = str(round(mem / 2**30))
    except Exception:
        pass
    return info


def forced_top1(heads, emb: np.ndarray, vocab) -> dict[str, str]:
    """What the model would answer without thresholds (to show what abstention buys)."""
    pg = heads.garment.probs(emb[None])[0]
    n = len(vocab.subcategories)
    sub_p = pg[:n]
    cats: dict[str, float] = {}
    for s, p in zip(vocab.subcategories, sub_p):
        cats[s.category] = cats.get(s.category, 0.0) + float(p)
    cat = max(cats, key=cats.get)
    in_cat = [i for i, s in enumerate(vocab.subcategories) if s.category == cat]
    sub = vocab.subcategories[max(in_cat, key=lambda i: sub_p[i])].id
    pat = heads.pattern.ids[int(np.argmax(heads.pattern.probs(emb[None])[0]))]
    return {"category": cat, "subcategory": sub, "pattern": pat}


def match_multi(expected: list[str], predicted: list[str | None]) -> tuple[int, int, int]:
    exp = Counter(expected)
    hit = 0
    for p in predicted:
        if p is not None and exp[p] > 0:
            exp[p] -= 1
            hit += 1
    return hit, len(expected), len(predicted)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--tag", default="", help="write eval/out/results_<tag>.json only (e.g. a CPU run)")
    args = ap.parse_args()
    settings = get_settings()
    backend = get_backend()
    vocab = load_vocabulary()
    rows = list(csv.DictReader((ROOT / "eval" / "manifest.csv").open(encoding="utf-8")))
    if args.limit:
        rows = rows[: args.limit]
    OUT.mkdir(parents=True, exist_ok=True)

    # Cold start: first request loads every model the pipeline needs.
    t = time.perf_counter()
    first = next((r for r in rows if r["mode"] == "multi"), rows[0])
    analyze_image((ROOT / "eval" / first["file"]).read_bytes(), mode="multi", max_items=8, backend=backend, settings=settings)
    analyze_image((ROOT / "eval" / rows[0]["file"]).read_bytes(), mode="single", max_items=1, backend=backend, settings=settings)
    cold_s = time.perf_counter() - t
    heads = get_heads(backend, settings)

    results = []
    embeddings, emb_ids = [], []
    tiles: list[tuple[str, Image.Image]] = []
    for r in rows:
        data = (ROOT / "eval" / r["file"]).read_bytes()
        t = time.perf_counter()
        res = analyze_image(data, mode=r["mode"], max_items=8, backend=backend, settings=settings)
        wall = (time.perf_counter() - t) * 1000
        items = res["items"]
        rec = {"id": r["id"], "mode": r["mode"], "split": r["split"], "latency_ms": round(wall, 1), "timings": res["timings_ms"],
               "scene": res.get("scene"), "n_items": len(items)}
        for k, it in enumerate(items):
            cut = Image.open(io.BytesIO(base64.b64decode(it["cutout_png_base64"])))
            tile = Image.new("RGB", cut.size, (200, 230, 200))
            tile.paste(cut, (0, 0), cut)
            tile.thumbnail((150, 150))
            label = (it["subcategory"] or it["category"] or {"value": "∅"})["value"]
            tiles.append((f"{r['id'][3:18]}:{label}", tile))
        if r["mode"] == "single":
            it = items[0]
            emb = np.array(it["embedding"], dtype=np.float32)
            embeddings.append(emb)
            emb_ids.append(r["id"])
            forced = forced_top1(heads, emb, vocab)
            rec.update(
                gold={k: r[k] for k in ("category", "subcategory", "color_family", "pattern")},
                pred={
                    "category": it["category"] and it["category"]["value"],
                    "category_conf": it["category"] and it["category"]["confidence"],
                    "subcategory": it["subcategory"] and it["subcategory"]["value"],
                    "subcategory_conf": it["subcategory"] and it["subcategory"]["confidence"],
                    "colors": [(c["family"], c["share"]) for c in it["colors"]],
                    "pattern": it["pattern"] and it["pattern"]["value"],
                    "materials": it["materials"],
                    "styles": it["styles"],
                    "seasons": it["seasons"],
                    "fit": it["fit"],
                    "warnings": it["quality"]["warnings"],
                },
                forced=forced,
            )
        else:
            rec.update(expected=r["multi_expected"].split(";") if r["multi_expected"] else [],
                       predicted=[(it["category"] or {}).get("value") if it["category"] else None for it in items],
                       predicted_sub=[(it["subcategory"] or {}).get("value") if it["subcategory"] else None for it in items])
        results.append(rec)
        print(f"{r['id']:<28} {wall:7.0f} ms  " + (
            f"cat={rec['pred']['category']} sub={rec['pred']['subcategory']} col={rec['pred']['colors'][:1]} pat={rec['pred']['pattern']}"
            if r["mode"] == "single" else f"items={rec['predicted']} sub={rec['predicted_sub']}"), flush=True)

    if not args.tag:
        np.savez(OUT / "embeddings.npz", ids=np.array(emb_ids), emb=np.stack(embeddings))

    def summarize(split: str) -> dict:
        sel = [x for x in results if split == "all" or x["split"] == split]
        single = [x for x in sel if x["mode"] == "single"]
        out: dict = {"n_single": len(single), "n_multi": len(sel) - len(single)}
        for attr in ("category", "subcategory", "pattern"):
            labeled = [x for x in single if x["gold"][attr]]
            answered = [x for x in labeled if x["pred"][attr] is not None]
            correct = [x for x in answered if accept(x["pred"][attr], x["gold"][attr])]
            forced_ok = [x for x in labeled if accept(x["forced"][attr], x["gold"][attr])]
            out[attr] = {
                "labeled": len(labeled),
                "coverage": pct(len(answered), len(labeled)),
                "abstain_rate": pct(len(labeled) - len(answered), len(labeled)),
                "accuracy_when_answered": pct(len(correct), len(answered)),
                "accuracy_over_all": pct(len(correct), len(labeled)),
                "forced_top1_accuracy": pct(len(forced_ok), len(labeled)),
            }
        labeled = [x for x in single if x["gold"]["color_family"]]
        prim = [x for x in labeled if x["pred"]["colors"] and accept(x["pred"]["colors"][0][0], x["gold"]["color_family"])]
        anyc = [x for x in labeled if any(accept(c[0], x["gold"]["color_family"]) for c in x["pred"]["colors"])]
        out["color_family"] = {"labeled": len(labeled), "primary_accuracy": pct(len(prim), len(labeled)), "any_of_top3_accuracy": pct(len(anyc), len(labeled))}
        for attr in ("materials", "styles", "seasons", "fit"):
            out[attr] = {"emitted_rate": pct(sum(1 for x in single if x["pred"][attr] is not None), len(single))}
        multi = [x for x in sel if x["mode"] == "multi"]
        hits = exp = pred = 0
        for x in multi:
            h, e, p = match_multi(x["expected"], x["predicted"])
            hits, exp, pred = hits + h, exp + e, pred + p
        out["multi"] = {"images": len(multi), "expected_items": exp, "predicted_items": pred,
                        "category_recall": pct(hits, exp), "category_precision": pct(hits, pred)}
        lat_s = [x["latency_ms"] for x in single]
        lat_m = [x["latency_ms"] for x in multi]
        out["latency_ms"] = {
            "single_p50": round(statistics.median(lat_s), 1) if lat_s else None,
            "single_p95": round(float(np.percentile(lat_s, 95)), 1) if lat_s else None,
            "multi_p50": round(statistics.median(lat_m), 1) if lat_m else None,
            "multi_p95": round(float(np.percentile(lat_m, 95)), 1) if lat_m else None,
        }
        stages = Counter()
        for x in single:
            for k, v in x["timings"].items():
                stages[k] += 0
        out["single_stage_median_ms"] = {
            k: round(statistics.median([x["timings"].get(k, 0.0) for x in single if k in x["timings"]]), 1) for k in stages
        }
        return out

    # Spanish text → image retrieval over the single-item embeddings (all splits).
    gold = {x["id"]: x["gold"] for x in results if x["mode"] == "single"}
    sub_label = {s.id: s.label.split("/")[0].strip().lower() for s in vocab.subcategories}
    fam_label = {f.id: f.label.lower() for f in vocab.color_families}
    queries: dict[str, set[str]] = {}
    for rid, g in gold.items():
        sub = g["subcategory"].split("|")[0]
        col = g["color_family"].split("|")[0]
        if sub and col:
            q = f"{sub_label[sub]} {fam_label[col]}"
            rel = {i for i, gg in gold.items() if sub in gg["subcategory"].split("|") and col in gg["color_family"].split("|")}
            queries[q] = rel
    E = np.stack(embeddings)
    ids = np.array(emb_ids)

    def retrieval(translate: bool) -> dict:
        qs = list(queries)
        if translate:
            T, translated = embed_text_queries(backend, qs)
        else:
            T = backend.embed_texts(qs)
            translated = qs
        r1 = r5 = 0
        rr = []
        for q, t in zip(qs, T):
            order = ids[np.argsort(-(E @ t))]
            ranks = [int(np.where(order == g)[0][0]) for g in queries[q]]
            best = min(ranks)
            r1 += best == 0
            r5 += best < 5
            rr.append(1 / (best + 1))
        return {"queries": len(qs), "recall_at_1": pct(r1, len(qs)), "recall_at_5": pct(r5, len(qs)),
                "mrr": round(statistics.mean(rr), 3), "examples": dict(list(zip(qs, translated))[:6])}

    def label_zero_shot() -> dict:
        """70-way: which Spanish subcategory label (e.g. "Cazadora vaquera") is closest to each
        garment embedding — raw Spanish text vs. the glossary translation used by /v1/embed/text."""
        labels = [s.label.split("/")[0].strip() for s in vocab.subcategories]
        sub_ids = [s.id for s in vocab.subcategories]
        rows_ = [(i, gold[i]["subcategory"].split("|")) for i in emb_ids if gold[i]["subcategory"]]
        X = np.stack([E[emb_ids.index(i)] for i, _ in rows_])

        def acc(T: np.ndarray) -> float:
            top = (X @ T.T).argmax(axis=1)
            return round(float(np.mean([sub_ids[t] in ok for t, (_, ok) in zip(top, rows_)])), 3)

        translated, _ = embed_text_queries(backend, labels)
        return {"items": len(rows_), "classes": len(labels), "top1_raw_spanish": acc(backend.embed_texts([l.lower() for l in labels])),
                "top1_translated": acc(translated)}

    summary = {
        "service_version": VERSION,
        "machine": machine_info(backend),
        "model_versions": backend.model_versions(),
        "thresholds": settings.thresholds.__dict__,
        "scales": {h: getattr(heads, h).scale for h in ("garment", "pattern", "material", "style", "warmth", "fit", "scene")},
        "cold_start_s": round(cold_s, 1),
        "splits": {s: summarize(s) for s in ("calib", "test", "all")},
        "text_retrieval": {"translated": retrieval(True), "raw_spanish": retrieval(False), "label_zero_shot": label_zero_shot()},
        "per_image": results,
    }
    (OUT / (f"results_{args.tag}.json" if args.tag else "results.json")).write_text(json.dumps(summary, indent=2, ensure_ascii=False))
    if args.tag:
        print(json.dumps({k: v for k, v in summary.items() if k != "per_image"}, indent=2, ensure_ascii=False))
        return 0

    cols = 10
    sheet = Image.new("RGB", (cols * 160, ((len(tiles) + cols - 1) // cols) * 172), "white")
    d = ImageDraw.Draw(sheet)
    for k, (label, tile) in enumerate(tiles):
        x, y = (k % cols) * 160, (k // cols) * 172
        sheet.paste(tile, (x, y))
        d.text((x + 2, y + 152), label[:26], fill="black")
    sheet.save(OUT / "cutouts.jpg", quality=80)

    print(json.dumps({k: v for k, v in summary.items() if k != "per_image"}, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
