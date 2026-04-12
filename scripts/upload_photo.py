#!/usr/bin/env python3
"""
Add a photo to this site locally: copy into photos/, update photos.json,
and write photos/thumbs/ (sips on macOS, else Pillow).

Destination basename: {date}_{sanitized_location}.ext, or ..._{N}.ext when
slots are taken (N is the smallest integer >= 1 not already used for that
date, location, and extension; the first file has no _N suffix).

After each run, photos.json is rewritten with the photos array sorted by date
(newest first), then by filename index N, then by location for stable ties.

This does not push to GitHub; run git add / commit / push yourself.

Example:
    python3 scripts/upload_photo.py ~/Pictures/sunset.jpg --date 2026-04-12 --location "Yosemite National Park" --caption "Half Dome"
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
from datetime import datetime
from pathlib import Path


def repo_root() -> Path:
    p = Path(__file__).resolve().parent.parent
    if (p / "photos.json").is_file():
        return p
    sys.exit("Run from repo root: photos.json should sit next to the scripts/ folder.")


def sanitize_location_loose(s: str) -> str:
    s = (s or "").strip()
    s = re.sub(r"[^\w\s,.-]", "", s, flags=re.UNICODE)
    s = re.sub(r"\s+", "_", s)
    return s or "unknown"


def sanitize_location(s: str) -> str:
    raw = (s or "").strip()
    if not raw:
        sys.exit("--location is required (used in the filename and in photos.json).")
    lo = sanitize_location_loose(raw)
    if lo == "unknown":
        sys.exit("After sanitizing, --location is empty; use letters, numbers, spaces, etc.")
    return lo


def parse_index_from_photo(photo: dict, date_str: str, loc_san: str) -> int:
    """Filename index for this date/location series (1 = no _N suffix). Unknown pattern -> large."""
    src = photo.get("src", "")
    if not isinstance(src, str) or not src.startswith("photos/"):
        return 10**6
    stem = Path(src).stem
    prefix = f"{date_str}_{loc_san}"
    if stem == prefix:
        return 1
    if stem.startswith(prefix + "_"):
        tail = stem[len(prefix) + 1 :]
        if tail.isdigit():
            return int(tail)
    return 10**6


def _date_sort_ts(d: str) -> float:
    try:
        return datetime.fromisoformat(d).timestamp()
    except (ValueError, TypeError, OSError):
        return 0.0


def photo_sort_key(photo: object) -> tuple[float, int, str]:
    if not isinstance(photo, dict):
        return (0.0, 10**6, "")
    d = photo.get("date") or ""
    loc = sanitize_location_loose(photo.get("location", ""))
    idx = parse_index_from_photo(photo, d, loc)
    return (-_date_sort_ts(d), idx, loc)


def sort_photos_list(photos: list) -> None:
    photos.sort(key=photo_sort_key)


def collect_used_indices(
    date_str: str,
    location_sanitized: str,
    ext: str,
    photos_dir: Path,
    thumbs_dir: Path,
    photo_entries: list,
) -> set[int]:
    """Slot 1 is the unnumbered file `{date}_{location}{ext}`; slot N>1 is `..._{N}{ext}`."""
    prefix = f"{date_str}_{location_sanitized}"
    ext_l = ext.lower()
    used: set[int] = set()

    def consider_filename(name: str) -> None:
        if Path(name).suffix.lower() != ext_l:
            return
        stem = Path(name).stem
        if stem == prefix:
            used.add(1)
            return
        if stem.startswith(prefix + "_"):
            tail = stem[len(prefix) + 1 :]
            if tail.isdigit():
                used.add(int(tail))

    for path in photos_dir.iterdir():
        if path.is_dir():
            continue
        consider_filename(path.name)

    if thumbs_dir.is_dir():
        for path in thumbs_dir.iterdir():
            if path.is_file():
                consider_filename(path.name)

    for item in photo_entries:
        if not isinstance(item, dict):
            continue
        src = item.get("src", "")
        if isinstance(src, str) and src.startswith("photos/"):
            consider_filename(Path(src).name)

    return used


def next_filename_for_date_location(
    date_str: str,
    location_sanitized: str,
    ext: str,
    photos_dir: Path,
    thumbs_dir: Path,
    photo_entries: list,
) -> str:
    used = collect_used_indices(
        date_str, location_sanitized, ext, photos_dir, thumbs_dir, photo_entries
    )
    n = 1
    while n in used:
        n += 1
    prefix = f"{date_str}_{location_sanitized}"
    if n == 1:
        return f"{prefix}{ext}"
    return f"{prefix}_{n}{ext}"


def thumb_sips(src: Path, dest: Path, max_edge: int) -> bool:
    if sys.platform != "darwin":
        return False
    dest.parent.mkdir(parents=True, exist_ok=True)
    r = subprocess.run(
        ["sips", "-Z", str(max_edge), str(src), "--out", str(dest)],
        capture_output=True,
        text=True,
    )
    return r.returncode == 0


def thumb_pillow(src: Path, dest: Path, max_edge: int) -> None:
    try:
        from PIL import Image
    except ImportError as e:
        sys.exit(
            "Need Pillow for thumbnails when sips is unavailable: pip install Pillow\n"
            + str(e)
        )
    dest.parent.mkdir(parents=True, exist_ok=True)
    suf = dest.suffix.lower()
    fmt = "JPEG" if suf in (".jpg", ".jpeg") else "PNG"
    with Image.open(src) as im:
        im.thumbnail((max_edge, max_edge), Image.Resampling.LANCZOS)
        out = im.convert("RGB") if fmt == "JPEG" and im.mode in ("RGBA", "P") else im
        save_kw = {"quality": 88, "optimize": True} if fmt == "JPEG" else {}
        out.save(dest, format=fmt, **save_kw)


def write_thumbnail(src: Path, dest: Path, max_edge: int) -> None:
    if thumb_sips(src, dest, max_edge):
        return
    thumb_pillow(src, dest, max_edge)


def main() -> None:
    root = repo_root()
    photos_dir = root / "photos"
    thumbs_dir = photos_dir / "thumbs"
    json_path = root / "photos.json"

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "source",
        type=Path,
        help="Path to the image file (JPEG/PNG/etc.)",
    )
    parser.add_argument(
        "--date",
        metavar="YYYY-MM-DD",
        required=True,
        help="Photo date (YYYY-MM-DD)",
    )
    parser.add_argument("--caption", default="", help="Lightbox caption")
    parser.add_argument(
        "--location",
        required=True,
        help="Lightbox location; also used in the filename after the date",
    )
    parser.add_argument(
        "--thumb-size",
        type=int,
        default=900,
        metavar="N",
        help="Longest edge for thumbnail (default: 900)",
    )
    args = parser.parse_args()

    src = args.source.expanduser().resolve()
    if not src.is_file():
        sys.exit(f"Not a file: {src}")

    d = args.date
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", d):
        sys.exit("--date must be YYYY-MM-DD")

    ext = src.suffix if src.suffix else ".jpg"
    loc_key = sanitize_location(args.location)

    with json_path.open(encoding="utf-8") as f:
        data = json.load(f)
    photos = data.get("photos")
    if not isinstance(photos, list):
        sys.exit("photos.json: missing or invalid 'photos' array")

    dest_name = next_filename_for_date_location(
        d, loc_key, ext, photos_dir, thumbs_dir, photos
    )
    dest_photo = photos_dir / dest_name
    dest_thumb = thumbs_dir / dest_name

    entry = {
        "src": f"photos/{dest_name}",
        "caption": args.caption,
        "location": args.location,
        "date": d,
    }

    photos_dir.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dest_photo)
    try:
        write_thumbnail(dest_photo, dest_thumb, args.thumb_size)
    except Exception as e:
        dest_photo.unlink(missing_ok=True)
        sys.exit(f"Thumbnail failed ({e}). Copied photo was removed; photos.json unchanged.")

    photos.append(entry)
    sort_photos_list(photos)

    with json_path.open("w", encoding="utf-8", newline="\n") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write("\n")

    print(f"Photo:  {dest_photo.relative_to(root)}")
    print(f"Thumb:  {dest_thumb.relative_to(root)}")
    print(f"JSON:   {json_path.name} (1 entry added; list sorted by date, index, location)")
    print("Next: git add, commit, and push if you use GitHub Pages.")


if __name__ == "__main__":
    main()
