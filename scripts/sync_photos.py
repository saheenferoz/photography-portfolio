#!/usr/bin/env python3
"""
Scan photos/ for images, add missing entries to photos.json (from filename),
ensure photos/thumbs/ exists for each, then sort the gallery list.

Expected filenames match upload_photo.py: {YYYY-MM-DD}_{location}[_{n}].ext
Location in JSON is underscores replaced by spaces (same as upload flow).

Run locally or in GitHub Actions after pushing new files into photos/.
"""

from __future__ import annotations

import json
import re
import sys
from datetime import datetime
from pathlib import Path

import upload_photo

IMAGE_EXT = frozenset({".jpg", ".jpeg", ".png", ".webp"})
THUMB_MAX = 900


def parse_stem(stem: str) -> dict[str, str] | None:
    if len(stem) < 12 or stem[10] != "_":
        return None
    date = stem[:10]
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", date):
        return None
    try:
        datetime.fromisoformat(date)
    except ValueError:
        return None
    rest = stem[11:]
    if not rest:
        return None
    m = re.fullmatch(r"(.+)_(\d+)$", rest)
    if m:
        loc_san = m.group(1)
    else:
        loc_san = rest
    return {
        "date": date,
        "location": loc_san.replace("_", " "),
        "caption": "",
    }


def main() -> None:
    root = Path(__file__).resolve().parent.parent
    json_path = root / "photos.json"
    photos_dir = root / "photos"
    thumbs_dir = photos_dir / "thumbs"

    if not json_path.is_file():
        sys.exit("photos.json not found")
    if not photos_dir.is_dir():
        sys.exit("photos/ not found")

    data = json.loads(json_path.read_text(encoding="utf-8"))
    photos = data.get("photos")
    if not isinstance(photos, list):
        sys.exit("Invalid photos array")

    orig_dump = json.dumps(data, indent=2, ensure_ascii=False) + "\n"

    by_src = {p.get("src"): p for p in photos if isinstance(p, dict) and p.get("src")}
    added = 0
    thumbs_written = 0

    for path in sorted(photos_dir.iterdir()):
        if not path.is_file():
            continue
        if path.suffix.lower() not in IMAGE_EXT:
            continue
        rel = f"photos/{path.name}"
        stem = path.stem

        if rel not in by_src:
            meta = parse_stem(stem)
            if not meta:
                print(f"skip (unrecognized name): {rel}", file=sys.stderr)
                continue
            entry = {
                "src": rel,
                "caption": meta["caption"],
                "location": meta["location"],
                "date": meta["date"],
            }
            photos.append(entry)
            by_src[rel] = entry
            added += 1
            print(f"added json: {rel}")

        dest_thumb = thumbs_dir / path.name
        if not dest_thumb.is_file():
            thumbs_dir.mkdir(parents=True, exist_ok=True)
            try:
                upload_photo.write_thumbnail(path, dest_thumb, THUMB_MAX)
                thumbs_written += 1
                print(f"wrote thumb: {dest_thumb.relative_to(root)}")
            except Exception as e:
                sys.exit(f"thumbnail failed for {path.name}: {e}")

    upload_photo.sort_photos_list(photos)

    new_dump = json.dumps(data, indent=2, ensure_ascii=False) + "\n"
    if new_dump != orig_dump:
        json_path.write_text(new_dump, encoding="utf-8", newline="\n")

    print(f"done: +{added} entries, {thumbs_written} thumbnails, json_updated={new_dump != orig_dump}")


if __name__ == "__main__":
    main()
