#!/usr/bin/env python3
"""
Re-sort the `photos` array in photos.json using the same order as upload_photo.py
(newest date first, then filename index _N, then location).

Example:
    python3 sort_photos_json.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path


def main() -> None:
    root = Path(__file__).resolve().parent
    json_path = root / "photos.json"
    if not json_path.is_file():
        sys.exit("photos.json not found next to this script.")

    import upload_photo

    data = json.loads(json_path.read_text(encoding="utf-8"))
    photos = data.get("photos")
    if not isinstance(photos, list):
        sys.exit("photos.json: missing or invalid 'photos' array")

    upload_photo.sort_photos_list(photos)

    json_path.write_text(
        json.dumps(data, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
        newline="\n",
    )
    print(f"Sorted {len(photos)} entries in {json_path.name}")


if __name__ == "__main__":
    main()
