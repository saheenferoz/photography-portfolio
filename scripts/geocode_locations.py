#!/usr/bin/env python3
"""
Geocode photo and travel-log locations for the map page.

Reads unique `location` values from photos.json and logs.json, skips ones
already present in locations.json, looks up the rest via the free Nominatim
(OpenStreetMap) API, and rewrites locations.json sorted by name.

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
USER_AGENT = "saheenferoz.github.io travel-portfolio geocoder"
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


def location_names(path: Path, list_key: str, required: bool) -> set[str]:
    if not path.is_file():
        if required:
            sys.exit(f"{path.name}: not found")
        return set()
    records = json.loads(path.read_text(encoding="utf-8")).get(list_key)
    if not isinstance(records, list):
        sys.exit(f"{path.name}: missing or invalid {list_key!r} array")
    return {
        r["location"].strip()
        for r in records
        if isinstance(r, dict) and isinstance(r.get("location"), str) and r["location"].strip()
    }


def main() -> None:
    root = repo_root()
    locations_path = root / "locations.json"

    known: dict = {}
    if locations_path.is_file():
        known = json.loads(locations_path.read_text(encoding="utf-8"))
        if not isinstance(known, dict):
            sys.exit("locations.json: expected a JSON object")

    wanted = location_names(root / "photos.json", "photos", required=True)
    wanted |= location_names(root / "logs.json", "entries", required=False)
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
