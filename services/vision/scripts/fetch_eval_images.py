"""Download the evaluation images listed in ``eval/manifest.csv`` into ``eval/images/``.

Images are CC0 / CC BY / CC BY-SA / public domain (Flickr via Openverse, Wikimedia
Commons); licence, author and source page are recorded per row in the manifest.
They are git-ignored: run this script to recreate the set.

    uv run python scripts/fetch_eval_images.py [--force]
"""

from __future__ import annotations

import argparse
import csv
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MANIFEST = ROOT / "eval" / "manifest.csv"
USER_AGENT = "DressItVisionEval/0.1 (evaluation image fetcher)"


def fetch(url: str, dest: Path, retries: int = 5) -> bool:
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            data = urllib.request.urlopen(req, timeout=60).read()
            dest.write_bytes(data)
            return True
        except Exception as exc:  # 429 from Wikimedia → back off
            wait = 15 * (attempt + 1)
            print(f"  retry {attempt + 1}/{retries} in {wait}s: {exc}", file=sys.stderr)
            time.sleep(wait)
    return False


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true", help="re-download existing files")
    args = ap.parse_args()
    rows = list(csv.DictReader(MANIFEST.open(encoding="utf-8")))
    failed = 0
    for row in rows:
        dest = ROOT / "eval" / row["file"]
        dest.parent.mkdir(parents=True, exist_ok=True)
        if dest.exists() and not args.force:
            continue
        print(f"{row['id']} ← {row['image_url']}")
        if not fetch(row["image_url"], dest):
            failed += 1
        time.sleep(3 if "wikimedia" in row["image_url"] else 0.5)
    print(f"done: {len(rows) - failed}/{len(rows)} images present")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
