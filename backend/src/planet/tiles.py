"""Turning Planet basemap metadata into storable tile templates (pure).

Planet hands back a ready-to-use tile link with the live API key inside its query
string, so the link can never be stored or sent to a browser as-is. Here it becomes
the ``{api_key}`` template the tile proxy substitutes server-side, exactly like every
other keyed provider URL in ``imagery/proxy.py``.

All URL building lives here rather than in the wizard: the frontend only ever picks a
finished template by visualization name.
"""

import math
import re
from dataclasses import dataclass
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

from src.planet.schemas import PlanetMosaicOut, PlanetSeriesMosaicsOut

TILE_HOST = "tiles.planet.com"
_LAYER_ID = re.compile(r"^[A-Za-z0-9_-]+$")

_XYZ_PLACEHOLDERS = ("{z}", "{x}", "{y}")

# Web-mercator ground resolution at the equator, halving with every zoom level.
_EQUATOR_METRES_PER_PIXEL = 156543.03392


class UnexpectedTileLink(ValueError):
    """Planet returned a tile link we will not store, rather than persist a URL
    whose key handling we cannot vouch for."""


@dataclass(frozen=True)
class Rendering:
    """A visualization a Planet series can serve, and the ``proc`` that produces it."""

    name: str
    proc: str | None


# Visual basemaps are pre-rendered RGB and take no ``proc``. Analytic basemaps carry
# the surface-reflectance bands the derived renderings are computed from.
VISUAL_RENDERINGS = (Rendering("Visual", None),)
ANALYTIC_RENDERINGS = (
    Rendering("Visual", "rgb"),
    Rendering("False Color", "cir"),
    Rendering("NDVI", "ndvi"),
)


def renderings_for(datatype: str | None) -> tuple[Rendering, ...]:
    """Which renderings a series supports, read off its mosaics' pixel type.

    Visual basemaps are 8-bit; analytic products keep their higher bit depth, which
    is what makes band math available.
    """
    return VISUAL_RENDERINGS if (datatype or "uint8") == "uint8" else ANALYTIC_RENDERINGS


def to_template(tiles_link: str) -> str:
    """Rewrite a mosaic's ``_links.tiles`` into a storable ``{api_key}`` template."""
    parsed = urlparse(tiles_link)
    if parsed.scheme != "https" or parsed.hostname != TILE_HOST:
        raise UnexpectedTileLink(f"tile link is not an https {TILE_HOST} URL: {tiles_link}")
    if not all(placeholder in parsed.path for placeholder in _XYZ_PLACEHOLDERS):
        raise UnexpectedTileLink(f"tile link is not an XYZ template: {tiles_link}")

    params = [(k, v) for k, v in parse_qsl(parsed.query) if k not in ("api_key", "proc")]
    params.append(("api_key", "{api_key}"))
    return urlunparse(parsed._replace(query=urlencode(params, safe="{}")))


def tile_urls(tiles_link: str, renderings: tuple[Rendering, ...]) -> dict[str, str]:
    """Every tile template one mosaic offers, keyed by visualization name."""
    template = to_template(tiles_link)
    return {
        r.name: (f"{template}&proc={r.proc}" if r.proc else template)  # api_key is emitted last
        for r in renderings
    }


def describe_series(series_id: str, mosaics: list[dict[str, Any]]) -> PlanetSeriesMosaicsOut:
    """Map a series' raw mosaics onto the tile templates the wizard turns into slices.

    A mosaic we cannot build tiles for is kept and marked, never dropped: a gap in a
    temporal series is something the person choosing it needs to see.
    """
    datatype = next((m.get("datatype") for m in mosaics if m.get("datatype")), None)
    renderings = renderings_for(datatype)
    resolution = next(
        (
            m["grid"]["resolution"]
            for m in mosaics
            if isinstance(m.get("grid"), dict) and m["grid"].get("resolution")
        ),
        None,
    )

    described = []
    for mosaic in mosaics:
        link = (mosaic.get("_links") or {}).get("tiles")
        reason = None
        urls: dict[str, str] = {}
        if not link:
            reason = "Planet did not return a tile link for this mosaic"
        else:
            try:
                urls = tile_urls(link, renderings)
            except UnexpectedTileLink as e:
                reason = str(e)
        described.append(
            PlanetMosaicOut(
                id=str(mosaic.get("id", "")),
                name=str(mosaic.get("name", "")),
                first_acquired=str(mosaic.get("first_acquired", ""))[:10],
                last_acquired=str(mosaic.get("last_acquired", ""))[:10],
                tile_urls=urls,
                unavailable_reason=reason,
            )
        )

    return PlanetSeriesMosaicsOut(
        series_id=series_id,
        renderings=[r.name for r in renderings],
        max_native_zoom=native_zoom(resolution),
        mosaics=described,
    )


def native_zoom(resolution: float | None) -> int | None:
    """The web-mercator zoom whose tiles match the mosaic's own pixels.

    Past it Planet has nothing more to show, and every request is a proxied
    round-trip for an upscaled tile the client could have produced itself.
    """
    if not resolution or resolution <= 0:
        return None
    # The zoom whose tiles most nearly match the mosaic's own pixels. Rounding rather
    # than always going finer matters: a level is a factor of two, and Planet's headline
    # resolutions sit exactly on one, where a floating-point hair would cost a whole level.
    zoom = round(math.log2(_EQUATOR_METRES_PER_PIXEL / resolution))
    return max(0, min(zoom, 22))


def layer_template(layer_id: str) -> str:
    """The storable XYZ template for a minted scene layer.

    Keyed like every other stored provider URL so the tiles go through the proxy. The
    layer id may authorize them on its own, but a keyless URL is a bearer token for
    those scenes and moves traffic off the one place consumption can be capped.
    """
    if not _LAYER_ID.match(layer_id):
        raise UnexpectedTileLink(f"layer id is not safe to put in a URL path: {layer_id}")
    return (
        f"https://{TILE_HOST}/data/v1/layers/{layer_id}/{{z}}/{{x}}/{{y}}.png?api_key={{api_key}}"
    )
