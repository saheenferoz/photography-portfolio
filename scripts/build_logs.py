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

# A place's type comes from which of these keys names it, e.g. `food: Some
# Cafe` instead of `type: food` + `name: Some Cafe`. `place:` is the plain
# "sight" case; the others double as the type. Notes are not here -- they
# aren't places, so they live in their own `notes:` list instead (see
# ALLOWED_TYPES / _parse_notes below).
TYPE_KEYS = {
    "place": "sight",
    "trail": "trail",
    "food": "food",
    "drive": "drive",
    "wildlife": "wildlife",
    "activity": "activity",
    "event": "event",
}
ALLOWED_TYPES = frozenset(TYPE_KEYS.values()) | {"note"}
ALLOWED_VERDICTS = frozenset({"repeat", "fine", "skip"})

COUNTRY_KEYS = frozenset({"country", "regions"})
REGION_KEYS = frozenset({"region", "areas", "notes"})
# An area is either a group (has 'places', holding several typed places) or a
# bare leaf: just 'area' naming a single sight, optionally with the same
# remark fields a place would have. The two modes can't mix -- see _parse_area.
AREA_KEYS = frozenset({"area", "location", "places", "notes", "verdict"})
PLACE_KEYS = frozenset(TYPE_KEYS) | {"notes", "verdict", "dishes", "location"}
DISH_KEYS = frozenset({"dish", "notes", "verdict"})


@dataclass
class Entry:
    country: str
    region: str
    area: str
    type: str
    name: str
    verdict: str
    # Resolution inputs, dropped before serializing.
    region_query: str
    area_location: str
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

    Every place has an area (a bare sight's area is just its own name; a
    drive or food with no fixed point uses an area named after the region).
    A place's own `location` always wins -- it's an explicit, deliberate
    choice. An area's `location` is the same kind of explicit choice, made
    once for every place nested under it, and wins over anything implicit.

    Absent either override, a place's own name may still reuse an existing
    key (typically one a photo already created) so it joins that pin instead
    of splitting off. Only after that does the area fall back to its own
    name (or a default "Area, Region"), so a place can't accidentally pull
    its whole area's pin somewhere unintended. An area named after its own
    region is just the region -- no ", Region" suffix to double up on.

    A note is a remark, not something to pin -- it never resolves to a
    location and never reaches the geocoder or the map.
    """
    if entry.type == "note":
        return ""
    if entry.override:
        return entry.override
    if entry.area_location:
        return entry.area_location
    for candidate in (entry.name, f"{entry.name}, {entry.region}"):
        if candidate in known:
            return candidate
    if entry.area == entry.region:
        return entry.region if entry.region in known else entry.region_query
    if entry.area in known:
        return entry.area
    return f"{entry.area}, {entry.region}"


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


def _parse_verdict(mapping: dict, where: str) -> str:
    if "verdict" not in mapping:
        return ""
    verdict = _require_str(mapping["verdict"], f"{where}.verdict")
    if verdict not in ALLOWED_VERDICTS:
        raise ValidationError(
            f"{where}.verdict: {verdict!r} is not one of {', '.join(sorted(ALLOWED_VERDICTS))}"
        )
    return verdict


def _parse_remarks(mapping: dict, where: str) -> list[str]:
    """A `notes:` list of remarks -- always a list, even for one remark, so
    there's exactly one way to attach a note to anything."""
    return [
        _require_str(n, f"{where}.notes[{i}]")
        for i, n in enumerate(_require_list(mapping.get("notes", []), f"{where}.notes"))
    ]


def _parse_dishes(raw: object, where: str) -> list[dict]:
    dishes: list[dict] = []
    for i, item in enumerate(_require_list(raw, where)):
        dish_where = f"{where}[{i}]"
        mapping = _require_mapping(item, dish_where)
        _check_keys(mapping, DISH_KEYS, dish_where)
        if "dish" not in mapping:
            raise ValidationError(f"{dish_where}: missing required field 'dish'")
        dish = {
            "name": _require_str(mapping["dish"], f"{dish_where}.dish"),
            "verdict": _parse_verdict(mapping, dish_where),
        }
        notes = _parse_remarks(mapping, dish_where)
        if notes:
            dish["notes"] = notes
        dishes.append(dish)
    return dishes


def _parse_place(
    raw: object,
    country: str,
    region: str,
    region_query: str,
    area: str,
    area_location: str,
    where: str,
) -> Entry:
    mapping = _require_mapping(raw, where)
    _check_keys(mapping, PLACE_KEYS, where)

    present = sorted(set(mapping) & set(TYPE_KEYS))
    if not present:
        raise ValidationError(
            f"{where}: missing one of {', '.join(sorted(TYPE_KEYS))} to name the place"
        )
    if len(present) > 1:
        raise ValidationError(f"{where}: only one of {', '.join(present)} is allowed")
    type_key = present[0]
    place_type = TYPE_KEYS[type_key]
    name = _require_str(mapping[type_key], f"{where}.{type_key}")

    verdict = _parse_verdict(mapping, where)
    notes = _parse_remarks(mapping, where)

    dishes: list[dict] = []
    if "dishes" in mapping:
        dishes = _parse_dishes(mapping["dishes"], f"{where}.dishes")
        if place_type != "food":
            raise ValidationError(
                f"{where}: dishes are only allowed on 'food' (got {type_key!r})"
            )

    return Entry(
        country=country,
        region=region,
        area=area,
        type=place_type,
        name=name,
        verdict=verdict,
        region_query=region_query,
        area_location=area_location,
        override=_require_str(mapping["location"], f"{where}.location")
        if "location" in mapping
        else "",
        items=dishes,
        notes=notes,
    )


def _parse_notes(raw: object, country: str, region: str, area: str, where: str) -> list[Entry]:
    """A `notes:` list holds plain remarks that aren't tied to any place --
    just the text, no type keyword needed. They never get a location."""
    entries = []
    for i, note in enumerate(_require_list(raw, where)):
        text = _require_str(note, f"{where}[{i}]")
        entries.append(
            Entry(
                country=country,
                region=region,
                area=area,
                type="note",
                name=text,
                verdict="",
                region_query="",
                area_location="",
                override="",
            )
        )
    return entries


def _parse_area(
    raw: object, country: str, region: str, region_query: str, where: str
) -> list[Entry]:
    mapping = _require_mapping(raw, where)
    _check_keys(mapping, AREA_KEYS, where)
    if "area" not in mapping:
        raise ValidationError(f"{where}: missing required field 'area'")
    area = _require_str(mapping["area"], f"{where}.area")

    if "places" not in mapping:
        # A leaf area: no group to speak of, the area name is a single sight.
        return [
            Entry(
                country=country,
                region=region,
                area=area,
                type="sight",
                name=area,
                verdict=_parse_verdict(mapping, where),
                region_query=region_query,
                area_location="",
                override=_require_str(mapping["location"], f"{where}.location")
                if "location" in mapping
                else "",
                notes=_parse_remarks(mapping, where),
            )
        ]

    if "verdict" in mapping:
        raise ValidationError(
            f"{where}.verdict: not allowed on an area with 'places' -- put it on the place instead"
        )

    area_location = (
        _require_str(mapping["location"], f"{where}.location") if "location" in mapping else ""
    )

    entries = [
        _parse_place(
            place_raw, country, region, region_query, area, area_location, f"{where}.places[{j}]"
        )
        for j, place_raw in enumerate(_require_list(mapping["places"], f"{where}.places"))
    ]
    if "notes" in mapping:
        entries.extend(_parse_notes(mapping["notes"], country, region, area, f"{where}.notes"))
    return entries


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
        if "region" not in region_map:
            raise ValidationError(f"{region_where}: missing required field 'region'")
        if not (region_map.keys() & {"areas", "notes"}):
            raise ValidationError(f"{region_where}: needs 'areas' and/or 'notes'")

        region = _require_str(region_map["region"], f"{region_where}.region")
        # A region that is also a country (Switzerland) uses its own name as the
        # geocode query; otherwise "Region, Country".
        region_query = region if region == country else f"{region}, {country}"

        for k, area_raw in enumerate(
            _require_list(region_map.get("areas", []), f"{region_where}.areas")
        ):
            entries.extend(
                _parse_area(area_raw, country, region, region_query, f"{region_where}.areas[{k}]")
            )

        if "notes" in region_map:
            entries.extend(
                _parse_notes(region_map["notes"], country, region, "", f"{region_where}.notes")
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
        # Skip the area segment when it just repeats the region or the place
        # itself (a leaf area, or one named after its own region).
        area = entry.area if entry.area not in (entry.region, entry.name) else ""
        base = "-".join(slugify(part) for part in (entry.region, area, entry.name) if part)
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
