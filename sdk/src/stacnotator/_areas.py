"""Administrative units from geoBoundaries (gbOpen, https://www.geoboundaries.org), fetched
one country and level at a time as simplified GeoJSON, never the whole dataset."""

import functools
import re
import unicodedata
from typing import Any

import requests

API = "https://www.geoboundaries.org/api/current/gbOpen"
LEVELS = ("ADM0", "ADM1", "ADM2", "ADM3", "ADM4", "ADM5")
# Words a user adds to a unit's name that geoBoundaries leaves out ("Story County" is "Story").
GENERIC = {
    "county", "district", "oblast", "raion", "rayon", "region", "province", "state",
    "municipality", "prefecture", "department", "governorate", "the", "of",
}  # fmt: skip


class AreaError(ValueError):
    pass


def _tokens(text: str) -> list[str]:
    plain = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode().lower()
    return [t for t in re.split(r"[^a-z0-9]+", plain) if t]


@functools.cache
def _units(country: str, level: str) -> tuple[str, list[dict[str, Any]]]:
    meta = requests.get(f"{API}/{country}/{level}/", timeout=30)
    if meta.status_code == 404 or not meta.text.strip().startswith("{"):
        return "", []
    meta.raise_for_status()
    info = meta.json()
    data = requests.get(info["simplifiedGeometryGeoJSON"], timeout=180)
    data.raise_for_status()
    source = f"geoBoundaries gbOpen {country} {level} ({info.get('boundaryYearRepresented')})"
    return source, data.json()["features"]


def _bbox(geometry: dict[str, Any]) -> list[float]:
    xs: list[float] = []
    ys: list[float] = []

    def walk(coords: Any) -> None:
        if isinstance(coords[0], (int, float)):
            xs.append(coords[0])
            ys.append(coords[1])
        else:
            for c in coords:
                walk(c)

    walk(geometry["coordinates"])
    return [round(min(xs), 5), round(min(ys), 5), round(max(xs), 5), round(max(ys), 5)]


def _matches(name: str, unit_name: str) -> int:
    """0 for no match, 2 for the same name, 1 when every word given starts a word of it."""
    wanted = [t for t in _tokens(name) if t not in GENERIC]
    have = [t for t in _tokens(unit_name) if t not in GENERIC]
    if not wanted:
        return 0
    if wanted == have:
        return 2
    return int(all(any(h.startswith(w) for h in have) for w in wanted))


def _unit(country: str, level: str, feature: dict[str, Any], source: str) -> dict[str, Any]:
    props = feature["properties"]
    return {
        "area_id": f"{country}/{level}/{props['shapeID']}",
        "name": props["shapeName"],
        "level": level,
        "country": country,
        "bbox": _bbox(feature["geometry"]),
        "source": source,
    }


def find(
    country: str, name: str, level: str | None = None, within: str | None = None
) -> list[dict[str, Any]]:
    country = country.strip().upper()
    if not re.fullmatch(r"[A-Z]{3}", country):
        raise AreaError("country is an ISO 3166-1 alpha-3 code, like USA, UKR or KEN.")
    if level is not None and level not in LEVELS:
        raise AreaError(f"level is one of {', '.join(LEVELS)}.")
    bounds = None
    if within:
        parents = find(country, within, "ADM1")
        if not parents:
            raise AreaError(f'No ADM1 unit of {country} is called "{within}".')
        bounds = parents[0]["bbox"]
    found = []
    for lvl in [level] if level else ["ADM1", "ADM2"]:
        source, features = _units(country, lvl)
        for feature in features:
            score = _matches(name, feature["properties"]["shapeName"])
            if not score:
                continue
            unit = _unit(country, lvl, feature, source)
            west, south, east, north = unit["bbox"]
            cx, cy = (west + east) / 2, (south + north) / 2
            if bounds and not (bounds[0] <= cx <= bounds[2] and bounds[1] <= cy <= bounds[3]):
                continue
            found.append((-score, unit))
    found.sort(key=lambda pair: pair[0])
    return [unit for _, unit in found[:10]]


def get(area_id: str) -> tuple[dict[str, Any], dict[str, Any]]:
    """The unit an id from find names, and its outline as GeoJSON geometry."""
    try:
        country, level, shape_id = area_id.split("/")
    except ValueError:
        raise AreaError(f'"{area_id}" is not an area_id from find_area.') from None
    source, features = _units(country, level)
    for feature in features:
        if feature["properties"]["shapeID"] == shape_id:
            return _unit(country, level, feature, source), feature["geometry"]
    raise AreaError(f'"{area_id}" is not an area_id from find_area.')
