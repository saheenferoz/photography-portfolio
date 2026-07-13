#!/usr/bin/env python3
"""
Geocode photo locations for the map page.

Reads unique `location` values from photos.json, skips ones already present
in locations.json, looks up the rest via the free Nominatim (OpenStreetMap)
API, and rewrites locations.json sorted by name.

Failed lookups are logged and skipped (exit code stays 0) so the sync
workflow never breaks; fix those by hand-editing locations.json.

Stdlib only — safe to run in GitHub Actions without extra dependencies.

Example:
    python3 scripts/geocode_locations.py
"""

from __future__ import annotations

import json
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
# Nominatim usage policy: identify the app and stay at <= 1 request/sec.
USER_AGENT = "saheenferoz.github.io photo-map geocoder"
REQUEST_INTERVAL_SECONDS = 1.1


def repo_root() -> Path:
    p = Path(__file__).resolve().parent.parent
    if (p / "photos.json").is_file():
        return p
    sys.exit("Run from repo root: photos.json should sit next to the scripts/ folder.")


def geocode(query: str) -> dict[str, float] | None:
    params = urllib.parse.urlencode({"q": query, "format": "json", "limit": 1})
    req = urllib.request.Request(
        f"{NOMINATIM_URL}?{params}", headers={"User-Agent": USER_AGENT}
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        results = json.load(resp)
    if not results:
        return None
    return {
        "lat": round(float(results[0]["lat"]), 5),
        "lng": round(float(results[0]["lon"]), 5),
    }


def main() -> None:
    root = repo_root()
    photos_path = root / "photos.json"
    locations_path = root / "locations.json"

    data = json.loads(photos_path.read_text(encoding="utf-8"))
    photos = data.get("photos")
    if not isinstance(photos, list):
        sys.exit("photos.json: missing or invalid 'photos' array")

    known: dict = {}
    if locations_path.is_file():
        known = json.loads(locations_path.read_text(encoding="utf-8"))
        if not isinstance(known, dict):
            sys.exit("locations.json: expected a JSON object")

    wanted = {
        p["location"].strip()
        for p in photos
        if isinstance(p, dict) and isinstance(p.get("location"), str) and p["location"].strip()
    }
    missing = sorted(wanted - set(known))

    failed = 0
    for i, name in enumerate(missing):
        if i > 0:
            time.sleep(REQUEST_INTERVAL_SECONDS)
        try:
            coords = geocode(name)
        except Exception as e:
            print(f"lookup error: {name!r}: {e}", file=sys.stderr)
            failed += 1
            continue
        if coords is None:
            print(f"no result: {name!r}", file=sys.stderr)
            failed += 1
            continue
        known[name] = coords
        print(f"geocoded: {name} -> {coords['lat']}, {coords['lng']}")

    out = dict(sorted(known.items()))
    locations_path.write_text(
        json.dumps(out, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
        newline="\n",
    )
    print(
        f"done: {len(missing) - failed} added, {failed} failed, "
        f"{len(out)} total in {locations_path.name}"
    )


if __name__ == "__main__":
    main()
