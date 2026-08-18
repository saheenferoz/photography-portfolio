#!/usr/bin/env python3
"""
Build logs.json from YAML country files under logs/.

Each logs/<country>.yaml holds one country and its regions. Output is a flat,
document-ordered list of entries; the page and the map group it at render time,
so regrouping later needs no data migration.

Each entry resolves to a `location` string that is used as a key into
locations.json. Resolution prefers keys that already exist there so a log entry
joins the photos and map pin for the same place instead of creating a near
duplicate. Names that resolve to something not yet in locations.json are printed
and left for geocode_locations.py to look up on the same workflow run.

Validation is strict: unknown fields, missing required keys, and bad enum values
exit non-zero so the GitHub Actions workflow refuses to commit a broken build.

Requires PyYAML (installed in the workflow alongside pillow).

Example:
    python3 scripts/build_logs.py
"""

from __future__ import annotations

import json
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

try:
    import yaml
except ImportError:
    sys.exit("PyYAML is required: pip install pyyaml")

SLUG_STRIP_RE = re.compile(r"[^a-z0-9]+")

DEFAULT_TYPE = "sight"
ALLOWED_TYPES = frozenset({"sight", "food", "drive", "wildlife", "trail", "note"})
ALLOWED_VERDICTS = frozenset({"repeat", "fine", "skip"})

COUNTRY_KEYS = frozenset({"country", "regions"})
REGION_KEYS = frozenset({"name", "places"})
PLACE_KEYS = frozenset(
    {"name", "area", "type", "note", "notes", "verdict", "dishes", "location"}
)
DISH_KEYS = frozenset({"name", "note", "verdict"})


@dataclass
class Entry:
    country: str
    region: str
    area: str
    type: str
    name: str
    note: str
    verdict: str
    # Resolution inputs, dropped before serializing.
    region_query: str
    area_override: str
    override: str
    location: str = ""
    id: str = ""
    items: list[dict] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)


class ValidationError(Exception):
    """Raised for any structural problem in a logs YAML file."""


def repo_root() -> Path:
    p = Path(__file__).resolve().parent.parent
    if (p / "logs").is_dir():
        return p
    sys.exit("Run from repo root: a logs/ folder should sit next to scripts/.")


def slugify(text: str) -> str:
    return SLUG_STRIP_RE.sub("-", text.lower()).strip("-")


def resolve_location(entry: Entry, known: set[str]) -> str:
    """Pick the locations.json key this entry belongs to.

    Inside an area, entry names only match keys that already exist -- a new key
    is never minted from one. That keeps restaurant names away from the geocoder
    and stops a place from splitting off its own pin away from its area.

    A sight listed directly under a region is different: it is usually a
    standalone landmark, so it earns its own key and gets geocoded. Drives and
    food stay on the region, since a highway has no single meaningful point.

    A note is a remark, not something to pin -- it never resolves to a
    location and never reaches the geocoder or the map.
    """
    if entry.type == "note":
        return ""
    if entry.override:
        return entry.override
    if entry.area_override:
        return entry.area_override
    for candidate in (entry.name, f"{entry.name}, {entry.region}"):
        if candidate in known:
            return candidate
    if entry.area:
        if entry.area in known:
            return entry.area
        return f"{entry.area}, {entry.region}"
    if entry.type == "sight":
        return f"{entry.name}, {entry.region}"
    if entry.region in known:
        return entry.region
    return entry.region_query


def _require_mapping(value: object, where: str) -> dict:
    if not isinstance(value, dict):
        raise ValidationError(f"{where}: expected a mapping, got {type(value).__name__}")
    return value


def _require_list(value: object, where: str) -> list:
    if not isinstance(value, list):
        raise ValidationError(f"{where}: expected a list, got {type(value).__name__}")
    return value


def _require_str(value: object, where: str, *, allow_empty: bool = False) -> str:
    if not isinstance(value, str):
        raise ValidationError(f"{where}: expected a string, got {type(value).__name__}")
    text = value.strip()
    if not text and not allow_empty:
        raise ValidationError(f"{where}: must be a non-empty string")
    return text


def _check_keys(mapping: dict, allowed: frozenset[str], where: str) -> None:
    unknown = sorted(set(mapping) - allowed)
    if unknown:
        raise ValidationError(f"{where}: unknown field(s) {', '.join(unknown)}")


def _parse_dishes(raw: object, where: str) -> list[dict]:
    dishes: list[dict] = []
    for i, item in enumerate(_require_list(raw, where)):
        dish_where = f"{where}[{i}]"
        mapping = _require_mapping(item, dish_where)
        _check_keys(mapping, DISH_KEYS, dish_where)
        if "name" not in mapping:
            raise ValidationError(f"{dish_where}: missing required field 'name'")
        dish = {
            "name": _require_str(mapping["name"], f"{dish_where}.name"),
            "note": "",
            "verdict": "",
        }
        if "note" in mapping:
            dish["note"] = _require_str(mapping["note"], f"{dish_where}.note", allow_empty=True)
        if "verdict" in mapping:
            verdict = _require_str(mapping["verdict"], f"{dish_where}.verdict")
            if verdict not in ALLOWED_VERDICTS:
                raise ValidationError(
                    f"{dish_where}.verdict: {verdict!r} is not one of "
                    f"{', '.join(sorted(ALLOWED_VERDICTS))}"
                )
            dish["verdict"] = verdict
        dishes.append(dish)
    return dishes


def _parse_place(raw: object, country: str, region: str, region_query: str, where: str) -> Entry:
    mapping = _require_mapping(raw, where)
    _check_keys(mapping, PLACE_KEYS, where)
    if "name" not in mapping:
        raise ValidationError(f"{where}: missing required field 'name'")

    place_type = DEFAULT_TYPE
    if "type" in mapping:
        place_type = _require_str(mapping["type"], f"{where}.type")
        if place_type not in ALLOWED_TYPES:
            raise ValidationError(
                f"{where}.type: {place_type!r} is not one of "
                f"{', '.join(sorted(ALLOWED_TYPES))}"
            )

    verdict = ""
    if "verdict" in mapping:
        verdict = _require_str(mapping["verdict"], f"{where}.verdict")
        if verdict not in ALLOWED_VERDICTS:
            raise ValidationError(
                f"{where}.verdict: {verdict!r} is not one of "
                f"{', '.join(sorted(ALLOWED_VERDICTS))}"
            )

    notes: list[str] = []
    if "notes" in mapping:
        for i, note in enumerate(_require_list(mapping["notes"], f"{where}.notes")):
            notes.append(_require_str(note, f"{where}.notes[{i}]"))

    dishes: list[dict] = []
    if "dishes" in mapping:
        dishes = _parse_dishes(mapping["dishes"], f"{where}.dishes")
        if place_type != "food":
            raise ValidationError(
                f"{where}: dishes are only allowed when type is 'food' (got {place_type!r})"
            )

    if "location" in mapping and place_type == "note":
        raise ValidationError(f"{where}: a 'note' is never geocoded, so 'location' is not allowed")

    return Entry(
        country=country,
        region=region,
        area=_require_str(mapping["area"], f"{where}.area") if "area" in mapping else "",
        type=place_type,
        name=_require_str(mapping["name"], f"{where}.name"),
        note=_require_str(mapping["note"], f"{where}.note", allow_empty=True)
        if "note" in mapping
        else "",
        verdict=verdict,
        region_query=region_query,
        area_override="",
        override=_require_str(mapping["location"], f"{where}.location")
        if "location" in mapping
        else "",
        items=dishes,
        notes=notes,
    )


def parse_country_file(path: Path) -> list[Entry]:
    try:
        data = yaml.safe_load(path.read_text(encoding="utf-8"))
    except yaml.YAMLError as exc:
        raise ValidationError(f"{path.name}: YAML parse error: {exc}") from exc

    where = path.name
    mapping = _require_mapping(data, where)
    _check_keys(mapping, COUNTRY_KEYS, where)
    for key in ("country", "regions"):
        if key not in mapping:
            raise ValidationError(f"{where}: missing required field {key!r}")

    country = _require_str(mapping["country"], f"{where}.country")
    region_query = country
    entries: list[Entry] = []

    for i, region_raw in enumerate(_require_list(mapping["regions"], f"{where}.regions")):
        region_where = f"{where}.regions[{i}]"
        region_map = _require_mapping(region_raw, region_where)
        _check_keys(region_map, REGION_KEYS, region_where)
        for key in ("name", "places"):
            if key not in region_map:
                raise ValidationError(f"{region_where}: missing required field {key!r}")

        region = _require_str(region_map["name"], f"{region_where}.name")
        # A region that is also a country (Switzerland) uses its own name as the
        # geocode query; otherwise "Region, Country".
        region_query = region if region == country else f"{region}, {country}"

        for j, place_raw in enumerate(
            _require_list(region_map["places"], f"{region_where}.places")
        ):
            entries.append(
                _parse_place(
                    place_raw,
                    country,
                    region,
                    region_query,
                    f"{region_where}.places[{j}]",
                )
            )

    return entries


def load_entries(logs_dir: Path) -> list[Entry]:
    files = sorted(logs_dir.glob("*.yaml")) + sorted(logs_dir.glob("*.yml"))
    # Deduplicate if both .yaml and .yml somehow exist for the same stem.
    seen: set[str] = set()
    unique: list[Path] = []
    for path in files:
        if path.stem in seen:
            raise ValidationError(f"duplicate country file for {path.stem!r}: {path.name}")
        seen.add(path.stem)
        unique.append(path)

    if not unique:
        raise ValidationError(f"{logs_dir.name}/: no .yaml files found")

    entries: list[Entry] = []
    for path in unique:
        entries.extend(parse_country_file(path))
    if not entries:
        raise ValidationError(f"{logs_dir.name}/: no places found across {len(unique)} file(s)")
    return entries


def assign_ids(entries: list[Entry]) -> None:
    seen: dict[str, int] = {}
    for entry in entries:
        base = "-".join(
            slugify(part) for part in (entry.region, entry.area, entry.name) if part
        )
        seen[base] = seen.get(base, 0) + 1
        entry.id = base if seen[base] == 1 else f"{base}-{seen[base]}"


def serialize(entry: Entry) -> dict:
    out = {
        "id": entry.id,
        "country": entry.country,
        "region": entry.region,
        "area": entry.area,
        "type": entry.type,
        "name": entry.name,
        "location": entry.location,
    }
    if entry.note:
        out["note"] = entry.note
    if entry.verdict:
        out["verdict"] = entry.verdict
    if entry.items:
        out["items"] = entry.items
    if entry.notes:
        out["notes"] = entry.notes
    return out


def main() -> None:
    root = repo_root()
    locations_path = root / "locations.json"

    known: set[str] = set()
    if locations_path.is_file():
        known = set(json.loads(locations_path.read_text(encoding="utf-8")))

    try:
        entries = load_entries(root / "logs")
    except ValidationError as exc:
        sys.exit(f"error: {exc}")

    assign_ids(entries)
    for entry in entries:
        entry.location = resolve_location(entry, known)

    pending = sorted({e.location for e in entries if e.location} - known)
    for name in pending:
        print(f"needs geocoding: {name}")

    (root / "logs.json").write_text(
        json.dumps({"entries": [serialize(e) for e in entries]}, indent=2, ensure_ascii=False)
        + "\n",
        encoding="utf-8",
        newline="\n",
    )
    print(f"done: {len(entries)} entries, {len(pending)} location(s) awaiting geocoding")


if __name__ == "__main__":
    main()
