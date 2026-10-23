"""Searching a Planet scene source where an annotator is standing.

A scene source is set up with dates only: the area to search is the annotator's
viewport, so nothing found here is stored and the answer is theirs alone.
"""

import logging
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import date

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from src.crypto import DecryptionError, decrypt
from src.imagery.models import ImageryCollection, ImagerySlice, ImagerySource
from src.imagery.registration import sanitize_error_message
from src.planet import client as planet_client
from src.planet import scenes as planet_scenes
from src.planet.schemas import (
    PlanetSceneSearchOut,
    PlanetScenesGenerationConfig,
    PlanetSceneSliceOut,
)

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class PlanetSceneSeries:
    """One scene series of a source, ready to search: what it asks Planet for, and the
    slices its dates already own."""

    config: PlanetScenesGenerationConfig
    slice_ids: dict[tuple[str, str], int]


def planet_scene_series(db: Session, source: ImagerySource) -> list[PlanetSceneSeries]:
    """Read what a search needs before any network call, so no connection is held
    across one."""
    series: list[PlanetSceneSeries] = []
    for stored in source.generation_series:
        if (stored.config or {}).get("kind") != "planet_scenes":
            continue
        rows = db.execute(
            select(ImagerySlice.id, ImagerySlice.start_date, ImagerySlice.end_date)
            .join(ImageryCollection, ImagerySlice.collection_id == ImageryCollection.id)
            .where(ImageryCollection.generation_series_id == stored.id)
        ).all()
        series.append(
            PlanetSceneSeries(
                config=PlanetScenesGenerationConfig.model_validate(stored.config),
                slice_ids={(row[1], row[2]): row[0] for row in rows},
            )
        )
    return series


def scene_source(
    db: Session, campaign_id: int, source_id: int
) -> tuple[str, list[PlanetSceneSeries]]:
    """The key to search with and the series to search, or the reason neither works."""
    source = db.get(ImagerySource, source_id)
    if source is None or source.campaign_id != campaign_id:
        raise HTTPException(status_code=404, detail="Imagery source not found")
    # A shared key with no host bound reads as no key at all - see ImagerySource. The
    # search itself would be safe (Planet's client pins the API host), but the layers it
    # mints are rendered through the proxy, which would refuse the key a moment later.
    key = source.provider_key
    if key is None:
        raise HTTPException(
            status_code=400,
            detail=(
                "No usable Planet API key is configured for this source. A shared "
                "organization key also needs the tile host it may be sent to."
            ),
        )
    try:
        api_key = decrypt(key.ciphertext)
    except DecryptionError as e:
        raise HTTPException(
            status_code=500, detail="The source's Planet API key could not be read"
        ) from e

    series = planet_scene_series(db, source)
    if not series:
        raise HTTPException(status_code=400, detail="This source has no Planet scene series")
    return api_key, series


def search_planet_scenes_in_view(
    api_key: str, series: list[PlanetSceneSeries], bbox: list[float]
) -> PlanetSceneSearchOut:
    """Which of the source's dates hold imagery here, with the covers ready to draw.

    Nothing is written. A minted layer belongs to the search that asked for it, so two
    annotators standing in different places never overwrite each other's imagery, and
    what a country-sized campaign area could never produce - a layer that actually
    covers where you are looking - falls out of bounding the search by the viewport.

    Only the covers are minted: a source can hold hundreds of slices, minting is one
    request each, and what the annotator sees on arrival is the cover of each window.
    The rest come back as found, so the dates are navigable straight away, and their
    layers are minted by ``mint_planet_scene_layers`` when a date is actually opened.
    """
    geometry = planet_scenes.bbox_polygon(bbox)
    found: list[PlanetSceneSliceOut] = []
    errors: list[str] = []

    for one in series:
        try:
            features = planet_client.search_config(api_key, one.config, geometry)
        except Exception as e:
            errors.append(sanitize_error_message(e, fallback="Planet scene search failed"))
            continue

        wanted = planet_scenes.matched(features, one.config, one.slice_ids)
        found.extend(
            PlanetSceneSliceOut(
                slice_id=match.slice_id, scene_count=len(match.group.scene_ids), layer_id=None
            )
            for match in wanted
            if not match.is_cover
        )
        minted, failures = _mint_layers(api_key, [m for m in wanted if m.is_cover])
        found.extend(minted)
        errors.extend(failures)

    _report(errors, bbox)
    return PlanetSceneSearchOut(slices=found, errors=errors)


def mint_planet_scene_layers(
    api_key: str, series: list[PlanetSceneSeries], bbox: list[float], slice_ids: list[int]
) -> PlanetSceneSearchOut:
    """Tile URLs for the dates being looked at now, over this same extent.

    Searched again rather than remembered: the search is bounded to the dates asked
    for, which is one request for a handful of neighbouring slices, and a stateless
    answer survives the worker recycling a cached one would not.
    """
    geometry = planet_scenes.bbox_polygon(bbox)
    wanted_ids = set(slice_ids)
    found: list[PlanetSceneSliceOut] = []
    errors: list[str] = []

    for one in series:
        dates = [d for d, sid in one.slice_ids.items() if sid in wanted_ids]
        if not dates:
            continue
        try:
            features = planet_client.search_range(
                api_key,
                one.config,
                geometry,
                date.fromisoformat(min(start for start, _ in dates)),
                date.fromisoformat(max(end for _, end in dates)),
            )
        except Exception as e:
            errors.append(sanitize_error_message(e, fallback="Planet scene search failed"))
            continue

        matches = planet_scenes.matched(features, one.config, one.slice_ids)
        minted, failures = _mint_layers(api_key, [m for m in matches if m.slice_id in wanted_ids])
        found.extend(minted)
        errors.extend(failures)

    _report(errors, bbox)
    return PlanetSceneSearchOut(slices=found, errors=errors)


def _mint_layers(
    api_key: str, wanted: list["planet_scenes.MatchedSlice"]
) -> tuple[list[PlanetSceneSliceOut], list[str]]:
    """One layer per slice, all of them at once; the failures come back as messages.

    A thread each because minting is a blocking POST that spends its time waiting, and
    how fast they actually leave is not this pool's business - the client paces every
    call to Planet, so the pool is sized to the work rather than to a limit of its own.
    """
    if not wanted:
        return [], []
    with ThreadPoolExecutor(max_workers=len(wanted)) as pool:
        results = list(pool.map(lambda m: _mint_view_layer(api_key, m.slice_id, m.group), wanted))
    return (
        [r for r in results if isinstance(r, PlanetSceneSliceOut)],
        [r for r in results if isinstance(r, str)],
    )


def _report(errors: list[str], bbox: list[float]) -> None:
    for message in errors:
        # Reported to the annotator and to us: a search that half worked still answers
        # 200, so without this the only record of why is a toast someone dismissed.
        logger.warning("Planet scene search over %s: %s", bbox, message)


def _mint_view_layer(
    api_key: str, slice_id: int, group: "planet_scenes.SliceGroup"
) -> PlanetSceneSliceOut | str:
    """One slice's layer, or the message saying why it has none."""
    try:
        return PlanetSceneSliceOut(
            slice_id=slice_id,
            scene_count=len(group.scene_ids),
            layer_id=planet_client.create_layer(api_key, list(group.scene_ids)),
        )
    except Exception as e:
        return sanitize_error_message(e, fallback="Minting the tile layer failed")
