"""Registration: turning stored collections into servable tile URLs.

Owns everything that talks to the outside world for that: parallel slice
registration against STAC providers (MPC direct or hosted tilers) with retries,
the equivalent for Planet scene sources (search once, mint one layer per slice),
the background thread that runs either off the request path, bbox-change
re-registration, and the manual refresh endpoint's re-ingest. Editor-state
persistence lives in ``service.py``; it only hands over plain snapshots.
"""

import copy
import json
import logging
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from datetime import datetime
from functools import partial

import httpx
from fastapi import HTTPException
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from src import background
from src.campaigns.models import Campaign
from src.config import get_settings
from src.crypto import DecryptionError, decrypt
from src.imagery.models import (
    ImageryCollection,
    ImageryGenerationSeries,
    ImagerySlice,
    ImagerySource,
    SliceTileUrl,
    VisualizationTemplate,
)
from src.imagery.schemas import CollectionStacConfigCreate
from src.imagery.tile_urls import _slice_viz_params
from src.layers import LayerOwner
from src.organizations.models import OrganizationApiKey
from src.planet import client as planet_client
from src.planet import scenes as planet_scenes
from src.planet import tiles as planet_tiles
from src.planet.schemas import PlanetScenesGenerationConfigV1
from src.tilers import providers
from src.visualizers.models import Visualizer

logger = logging.getLogger(__name__)

MPC_REGISTER_URL = "https://planetarycomputer.microsoft.com/api/data/v1/mosaic/register"
# Minting is a small POST each; the cap is politeness to Planet, not our own limit.
PLANET_MINT_WORKERS = 8


def sanitize_error_message(exc: Exception, *, fallback: str) -> str:
    """Generic-exception sanitizing tail shared by the mosaic and embedding paths.

    Only exposes the exception type + first line, never internal paths,
    credentials, or stack traces.
    """
    msg = str(exc).split("\n")[0]
    if "/" in msg and ("site-packages" in msg or "/app/" in msg):
        return f"{fallback} ({type(exc).__name__})"
    return msg[:200] if msg else f"{fallback} ({type(exc).__name__})"


def _sanitize_stac_error(e: Exception) -> str:
    """Extract a user-facing error message from a STAC registration exception.

    Only exposes information about the STAC query / HTTP response, never
    internal paths, credentials, or stack traces.
    """
    if isinstance(e, HTTPException):
        # load_refreshable_collection raises HTTPException with a curated detail
        # (e.g. "Collection not found ..."); surface the detail alone.
        return str(e.detail)
    if isinstance(e, httpx.HTTPStatusError):
        status = e.response.status_code
        # Try to extract a message from the response body
        try:
            body = e.response.json()
            detail = body.get("detail") or body.get("message") or body.get("description", "")
            if detail:
                return f"HTTP {status}: {detail}"
        except Exception:
            logger.debug("Could not parse tile server error response", exc_info=True)
        return f"HTTP {status} from tile server"
    return sanitize_error_message(e, fallback="Registration failed")


@dataclass(frozen=True)
class _SliceRef:
    """Plain snapshot of the slice fields registration needs. Captured before the
    read transaction is released so the parallel-HTTP phase never dereferences a
    session-bound ORM object (which would reopen a transaction, off-thread)."""

    id: int
    name: str
    start_date: str
    end_date: str


@dataclass(frozen=True)
class StacRegistrationSpec:
    """A work order: what registering one STAC collection needs, as plain data.

    Built by the imagery-editor save flow at the point a collection is created or
    its search-affecting fields change, and handed to
    ``spawn_background_registration``. Plain data because the background thread
    must never touch a request-scoped ORM object.
    """

    collection_id: int
    collection_name: str
    stac_config: CollectionStacConfigCreate
    has_dedicated_cover: bool
    cover_slice_index: int
    source_viz_names: list[str]


def _register_all_stac_browser_collections(
    db: Session,
    pending: list[StacRegistrationSpec],
    bbox: list[float],
    tile_scope: str,
) -> list[dict]:
    """Register mosaics for all stac_browser collections in parallel with retries.
    Returns a list of error dicts for failed slices (empty on full success).

    Each slice's vizs are routed per provider (MPC direct vs a configured hosted
    titiler-pgstac tiler) and the absolute tile URL is baked into the SliceTileUrl rows.

    The DB connection is released (commit) after the read phase and before the slow
    parallel STAC calls, then re-acquired for the writes - otherwise the transaction
    sits idle across the calls and Postgres reaps it at idle_in_transaction_session_timeout.
    """
    MAX_WORKERS = 16
    MAX_RETRIES = 2

    # Build a flat list of tasks
    tasks: list[dict] = []
    for spec in pending:
        stac = spec.stac_config

        # Validate viz name parity between source and stac_config
        stac_names = [v.name for v in stac.visualizations]
        if set(spec.source_viz_names) != set(stac_names):
            raise ValueError(
                f"Visualization name mismatch in collection '{spec.collection_name}': "
                f"source has {spec.source_viz_names}, stac_config has {stac_names}"
            )

        # Per-visualization params dicts for URL baking
        viz_params_by_name: dict[str, dict] = {
            v.name: v.viz_params.model_dump(exclude_none=True) for v in stac.visualizations
        }
        cover_viz_params_by_name: dict[str, dict] = {
            v.name: v.cover_viz_params.model_dump(exclude_none=True)
            for v in stac.visualizations
            if v.cover_viz_params
        }
        # Custom search queries
        search_query = stac.search_query
        cover_search_query = stac.cover_search_query

        db_slices = (
            db.execute(
                select(ImagerySlice)
                .where(ImagerySlice.collection_id == spec.collection_id)
                .order_by(ImagerySlice.display_order)
            )
            .scalars()
            .all()
        )

        for sl_idx, db_slice in enumerate(db_slices):
            is_cover = spec.has_dedicated_cover and sl_idx == spec.cover_slice_index

            # Effective per-viz params for this slice (cover override if present)
            slice_viz_by_name: dict[str, dict] = {
                name: (
                    cover_viz_params_by_name[name]
                    if is_cover and name in cover_viz_params_by_name
                    else params
                )
                for name, params in viz_params_by_name.items()
            }

            # Route each viz to a provider ("mpc" direct vs a hosted tiler).
            provider_by_viz = {
                name: providers.select_provider(stac.catalog_url, p)
                for name, p in slice_viz_by_name.items()
            }
            any_uses_mpc = any(v == "mpc" for v in provider_by_viz.values())
            any_needs_hosted = any(v == "hosted" for v in provider_by_viz.values())

            tasks.append(
                {
                    "slice": _SliceRef(
                        id=db_slice.id,
                        name=db_slice.name,
                        start_date=db_slice.start_date,
                        end_date=db_slice.end_date,
                    ),
                    "stac": stac,
                    "viz_params_by_name": slice_viz_by_name,
                    "any_uses_mpc": any_uses_mpc,
                    "any_needs_hosted": any_needs_hosted,
                    "collection_name": spec.collection_name,
                    "tiler_name": stac.tiler or get_settings().DEFAULT_TILER,
                    "search_query": cover_search_query
                    if (is_cover and cover_search_query)
                    else search_query,
                }
            )

    if not tasks:
        return []

    # Resolve each hosted tiler once; MPC-only collections resolve none.
    tilers_by_name: dict[str, providers.TilerCfg] = {}
    for name in {t["tiler_name"] for t in tasks if t["any_needs_hosted"]}:
        try:
            tilers_by_name[name] = providers.resolve_tiler(name)
        except ValueError:
            raise ValueError(f"Unknown tiler '{name}'") from None

    logger.info(
        "Registering %d mosaic slices in parallel (%d need MPC, %d need hosted)",
        len(tasks),
        sum(1 for t in tasks if t["any_uses_mpc"]),
        sum(1 for t in tasks if t["any_needs_hosted"]),
    )

    # Everything registration needs is now snapshotted into `tasks`; release the
    # read transaction (returns the connection to the pool) so it isn't held idle
    # across the slow parallel STAC calls below. The write phase re-acquires.
    db.commit()

    # Collect user-facing error messages (no internal details)
    registration_errors: list[dict] = []

    def _register_one_with_retry(task: dict) -> tuple[int, str | None, str | None]:
        """Returns (slice_id, mpc_search_id_or_none, hosted_search_id_or_none).

        A slice can need MPC, a hosted tiler, or both depending on the mix of
        per-visualization params. If a required registration fails after retries, the
        corresponding result is None and an error is recorded.
        """
        slice_ref = task["slice"]
        stac = task["stac"]
        dt_range = f"{slice_ref.start_date}T00:00:00Z/{slice_ref.end_date}T23:59:59Z"
        custom_query = task.get("search_query")

        def _run(fn, label: str):
            last_error = ""
            for attempt in range(MAX_RETRIES + 1):
                try:
                    return fn()
                except Exception as e:
                    last_error = _sanitize_stac_error(e)
                    if attempt < MAX_RETRIES:
                        time.sleep(1 * (attempt + 1))
                        continue
                    logger.warning(
                        "%s registration failed after %d retries for %s slice %s (%s)",
                        label,
                        MAX_RETRIES,
                        task["collection_name"],
                        slice_ref.name,
                        dt_range,
                        exc_info=True,
                    )
                    registration_errors.append(
                        {
                            "collection": task["collection_name"],
                            "slice": slice_ref.name,
                            "datetime": dt_range,
                            "error": last_error,
                        }
                    )
                    return None

        mpc_search_id = None
        hosted_search_id = None
        if task["any_uses_mpc"]:
            mpc_search_id = _run(
                lambda: _register_mpc_slice(stac, slice_ref, bbox, custom_query), "MPC"
            )
        if task["any_needs_hosted"]:
            hosted_search_id = _run(
                lambda: _register_hosted_slice(
                    stac,
                    slice_ref,
                    bbox,
                    custom_query,
                    tile_scope,
                    tilers_by_name[task["tiler_name"]],
                ),
                "Hosted tiler",
            )
        return slice_ref.id, mpc_search_id, hosted_search_id

    # Execute all in parallel. slice_id -> (mpc_search_id | None, hosted_search_id | None)
    results: dict[int, tuple[str | None, str | None]] = {}
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        futures = {pool.submit(_register_one_with_retry, t): t for t in tasks}
        for future in as_completed(futures):
            slice_id, mpc_search_id, hosted_search_id = future.result()
            results[slice_id] = (mpc_search_id, hosted_search_id)

    succeeded = sum(1 for _, (m, h) in results.items() if (m is not None or h is not None))
    logger.info("STAC registration complete: %d/%d slices succeeded", succeeded, len(tasks))

    task_by_slice: dict[int, dict] = {t["slice"].id: t for t in tasks}

    # Emit one SliceTileUrl per visualization, routed per provider.
    for slice_id, (mpc_search_id, hosted_search_id) in results.items():
        task = task_by_slice[slice_id]
        stac = task["stac"]
        for viz_name, params in task["viz_params_by_name"].items():
            if providers.select_provider(stac.catalog_url, params) == "mpc":
                if mpc_search_id is None:
                    continue
                tile_url = providers.build_tile_url(
                    "mpc", mpc_search_id, params, collection_id=stac.stac_collection_id
                )
                provider_name, ref = "mpc", mpc_search_id
            else:
                if hosted_search_id is None:
                    continue
                tile_url = providers.build_tile_url(
                    "hosted",
                    hosted_search_id,
                    params,
                    tiler=tilers_by_name[task["tiler_name"]],
                )
                provider_name, ref = task["tiler_name"], hosted_search_id
            db.add(
                SliceTileUrl(
                    slice_id=slice_id,
                    visualization_name=viz_name,
                    tile_url=tile_url,
                    tile_provider=provider_name,
                    mosaic_id=ref,
                )
            )

    return registration_errors


@dataclass(frozen=True)
class PlanetRegistrationSpec:
    """The same work order for one Planet series, which mints layers instead.

    Per series rather than per collection, because one search covers every window
    the series produced.
    """

    source_id: int
    source_name: str
    generation_series_id: int
    config: PlanetScenesGenerationConfigV1
    visualization_name: str


@dataclass(frozen=True)
class PendingRegistrations:
    """What one save left for registration to do, by provider path.

    Both paths end at the same place - a provider id and a tile URL against each
    slice - so they travel together and share one background run and one status
    field. Empty means there is nothing to spawn.
    """

    stac: list[StacRegistrationSpec] = field(default_factory=list)
    planet: list[PlanetRegistrationSpec] = field(default_factory=list)

    def __bool__(self) -> bool:
        return bool(self.stac or self.planet)


def pending_planet_registrations(
    db: Session, source_ids: list[int]
) -> list[PlanetRegistrationSpec]:
    """Planet scene series whose slices are still missing their tile URLs.

    Being derived from the stored state rather than from what the save changed is
    what makes this self-healing: a new source qualifies, a regenerated one whose
    slice rows were replaced qualifies, a rename does not, and a run that failed
    halfway retries on the next save.
    """
    if not source_ids:
        return []
    db.flush()
    specs: list[PlanetRegistrationSpec] = []
    series_rows = (
        db.execute(
            select(ImageryGenerationSeries).where(ImageryGenerationSeries.source_id.in_(source_ids))
        )
        .scalars()
        .all()
    )
    for series in series_rows:
        if series.config.get("kind") != "planet_scenes":
            continue
        source = db.get(ImagerySource, series.source_id)
        # Queried rather than read off ``source.visualizations``: the save adds those
        # rows by foreign key, so a source created in this transaction still has an
        # empty relationship collection here and the series would be skipped.
        visualization_name = db.execute(
            select(VisualizationTemplate.name)
            .where(VisualizationTemplate.source_id == series.source_id)
            .order_by(VisualizationTemplate.display_order)
            .limit(1)
        ).scalar()
        if source is None or visualization_name is None:
            continue
        unregistered = db.execute(
            select(ImagerySlice.id)
            .join(ImageryCollection, ImagerySlice.collection_id == ImageryCollection.id)
            .outerjoin(SliceTileUrl, SliceTileUrl.slice_id == ImagerySlice.id)
            .where(
                ImageryCollection.generation_series_id == series.id,
                SliceTileUrl.id.is_(None),
            )
            .limit(1)
        ).first()
        if unregistered is None:
            continue
        specs.append(
            PlanetRegistrationSpec(
                source_id=source.id,
                source_name=source.name,
                generation_series_id=series.id,
                config=PlanetScenesGenerationConfigV1.model_validate(series.config),
                visualization_name=visualization_name,
            )
        )
    return specs


def _provider_key(db: Session, source: ImagerySource) -> str | None:
    """The source's Planet key in plaintext, from wherever it is stored."""
    ciphertext = source.encrypted_api_key
    if ciphertext is None and source.organization_api_key_id is not None:
        organization_key = db.get(OrganizationApiKey, source.organization_api_key_id)
        ciphertext = organization_key.encrypted_key if organization_key else None
    if not ciphertext:
        return None
    try:
        return decrypt(ciphertext)
    except DecryptionError:
        return None


def _mint_slice_layer(
    api_key: str, source_name: str, job: tuple[int, "planet_scenes.SliceGroup"]
) -> tuple[int, str] | dict:
    """One slice's layer, or the error dict describing why it has none."""
    slice_id, group = job
    try:
        return slice_id, planet_client.create_layer(api_key, list(group.scene_ids))
    except Exception as e:
        return {
            "collection": source_name,
            "slice": group.name,
            "datetime": f"{group.period.start}/{group.period.end}",
            "error": sanitize_error_message(e, fallback="Minting the tile layer failed"),
        }


def _register_planet_sources(db: Session, specs: list[PlanetRegistrationSpec]) -> list[dict]:
    """Search once per series, then mint one tile layer per slice.

    The search is the expensive call and one covers every window, so it runs per
    series; minting is a small POST per slice and parallelizes. Slices are matched to
    what the search produced by date range, because both sides come from the same
    pure grouping in ``planet.scenes``.

    Same transaction discipline as the STAC path: everything needed is snapshotted,
    the read transaction is released, and the writes re-acquire - otherwise the
    connection sits idle across the network calls until Postgres reaps it.
    """
    if not specs:
        return []

    errors: list[dict] = []
    jobs: list[tuple[PlanetRegistrationSpec, str, dict[tuple[str, str], int]]] = []
    for spec in specs:
        source = db.get(ImagerySource, spec.source_id)
        if source is None:
            continue
        api_key = _provider_key(db, source)
        if api_key is None:
            errors.append(
                {
                    "collection": spec.source_name,
                    "slice": "",
                    "datetime": "",
                    "error": "No usable Planet API key is configured for this source",
                }
            )
            continue
        slice_rows = db.execute(
            select(ImagerySlice.id, ImagerySlice.start_date, ImagerySlice.end_date)
            .join(ImageryCollection, ImagerySlice.collection_id == ImageryCollection.id)
            .where(ImageryCollection.generation_series_id == spec.generation_series_id)
        ).all()
        jobs.append((spec, api_key, {(row[1], row[2]): row[0] for row in slice_rows}))

    db.commit()

    minted: list[tuple[int, str, str]] = []
    for spec, api_key, slice_ids in jobs:
        config = spec.config
        try:
            features = planet_client.search_scenes(
                api_key,
                geometry=config.aoi,
                start=config.start_date,
                end=config.end_date,
                item_types=config.item_types,
                max_cloud_cover=config.max_cloud_cover,
                quality_categories=config.quality_categories,
            )
        except Exception as e:
            errors.append(
                {
                    "collection": spec.source_name,
                    "slice": "",
                    "datetime": f"{config.start_date}/{config.end_date}",
                    "error": sanitize_error_message(e, fallback="Planet scene search failed"),
                }
            )
            continue

        wanted: list[tuple[int, planet_scenes.SliceGroup]] = []
        for window in planet_scenes.group(features, config):
            for group in (*([window.cover] if window.cover else []), *window.slices):
                slice_id = slice_ids.get(
                    (group.period.start.isoformat(), group.period.end.isoformat())
                )
                if slice_id is not None:
                    wanted.append((slice_id, group))

        empty = len(slice_ids) - len(wanted)
        if empty > 0:
            errors.append(
                {
                    "collection": spec.source_name,
                    "slice": f"{empty} of {len(slice_ids)} slices",
                    "datetime": f"{config.start_date}/{config.end_date}",
                    "error": "Planet returned no usable scenes for these dates",
                }
            )

        with ThreadPoolExecutor(max_workers=PLANET_MINT_WORKERS) as pool:
            results = pool.map(partial(_mint_slice_layer, api_key, spec.source_name), wanted)
        for result in results:
            if isinstance(result, dict):
                errors.append(result)
            else:
                minted.append((*result, spec.visualization_name))

    logger.info("Planet scene registration minted %d layers", len(minted))

    for slice_id, layer_id, visualization_name in minted:
        db.execute(
            delete(SliceTileUrl).where(
                SliceTileUrl.slice_id == slice_id,
                SliceTileUrl.visualization_name == visualization_name,
            )
        )
        db.add(
            SliceTileUrl(
                slice_id=slice_id,
                visualization_name=visualization_name,
                tile_url=planet_tiles.layer_template(layer_id),
                # Null provider: a direct URL fetched through our own tile proxy, which
                # is also what keeps the key off the client. See SliceTileUrl.
                tile_provider=None,
                mosaic_id=layer_id,
            )
        )

    return errors


# The imagery domain's background run: registration and collection
# refresh both report through this status/heartbeat pair on the campaign.
REGISTRATION_RUN = background.StatusField(
    model=Campaign,
    status_column="registration_status",
    heartbeat_column="registration_heartbeat_at",
    errors_column="registration_errors",
    interrupted_error=(
        "Imagery registration was interrupted by a server restart. "
        "Save the imagery again or refresh the affected collection to retry."
    ),
)

VISUALIZER_REGISTRATION_RUN = background.StatusField(
    model=Visualizer,
    status_column="registration_status",
    heartbeat_column="registration_heartbeat_at",
    errors_column="registration_errors",
    interrupted_error=(
        "Imagery registration was interrupted by a server restart. "
        "Save the visualizer again to retry."
    ),
)


def status_run_for(owner: LayerOwner) -> tuple[int, background.StatusField]:
    """The row and status columns a registration run for this owner writes to."""
    if owner.campaign_id is not None:
        return owner.campaign_id, REGISTRATION_RUN
    if owner.visualizer_id is not None:
        return owner.visualizer_id, VISUALIZER_REGISTRATION_RUN
    raise ValueError("An imagery source must belong to a campaign or a visualizer")


def spawn_background_registration(
    owner: LayerOwner,
    pending: PendingRegistrations,
    bbox: list[float],
) -> None:
    """Run registration off the request path (see src/background.py).

    Registration makes many slow parallel provider calls; doing it inline holds the
    request's write transaction open across them and trips the
    idle-in-transaction backstop. The request commits the entity reconciliation
    (and begin_status_run) first, then calls this to rebuild the tile URLs and
    flip `registration_status` to ready/failed when done.

    ``pending`` is already plain data (see `StacRegistrationSpec`), so the thread
    hands it straight to registration without touching any ORM object from the
    request session. Both provider paths share this one run rather than getting one
    each: they would otherwise contend for the single status field this owner has.
    """
    row_id, status_field = status_run_for(owner)

    def work(db: Session) -> list[dict]:
        errors = _register_all_stac_browser_collections(db, pending.stac, bbox, owner.tile_scope)
        return errors + _register_planet_sources(db, pending.planet)

    background.spawn_status_run(
        row_id,
        status_field,
        name="imagery registration",
        work=work,
        sanitize_error=lambda exc: f"Imagery registration: {_sanitize_stac_error(exc)}",
    )


def spawn_background_collection_refresh(
    campaign_id: int,
    collection_id: int,
    bbox: list[float],
) -> None:
    """Run a manual collection re-ingest off the request path (see src/background.py).

    Refresh re-ingests every slice's AOI into the hosted tiler's pgstac, one HTTP
    call per slice, which can take minutes across a whole collection; doing it
    inline holds the request's transaction open across those calls and trips the
    idle-in-transaction backstop.
    """

    def work(db: Session) -> None:
        refresh_collection_imagery(db, collection_id, campaign_id, bbox)

    background.spawn_status_run(
        campaign_id,
        REGISTRATION_RUN,
        name=f"collection {collection_id} refresh",
        work=work,
        sanitize_error=lambda exc: f"Collection refresh: {_sanitize_stac_error(exc)}",
    )


def refreshable_collection_ids(db: Session, source_id: int, campaign_id: int) -> list[int]:
    """Every collection of this source whose STAC search can be re-run, in
    display order. 404s for a source outside the caller's campaign, and 400s
    when the source holds nothing re-searchable (a manual-URL source has no
    catalog to ask again)."""
    source = db.execute(
        select(ImagerySource).where(
            ImagerySource.id == source_id, ImagerySource.campaign_id == campaign_id
        )
    ).scalar_one_or_none()
    if source is None:
        raise HTTPException(status_code=404, detail="Source not found")

    ids = [
        collection.id
        for collection in source.collections
        if collection.stac_config
        and collection.stac_config.catalog_url
        and collection.stac_config.stac_collection_id
    ]
    if not ids:
        raise HTTPException(
            status_code=400, detail="This source has no STAC collections to re-register"
        )
    return ids


def spawn_background_source_refresh(
    campaign_id: int,
    collection_ids: list[int],
    bbox: list[float],
) -> None:
    """Re-ingest a whole source in one background run, so the campaign's
    registration status flips once for the source rather than racing between
    one run per collection."""

    def work(db: Session) -> None:
        for collection_id in collection_ids:
            refresh_collection_imagery(db, collection_id, campaign_id, bbox)

    background.spawn_status_run(
        campaign_id,
        REGISTRATION_RUN,
        name=f"source refresh ({len(collection_ids)} collections)",
        work=work,
        sanitize_error=lambda exc: f"Source refresh: {_sanitize_stac_error(exc)}",
    )


def _resolved_search_body(search_query: dict | None, bbox: list[float], db_slice) -> dict:
    """Deepcopy the CQL2-JSON query and inject bbox + this slice's datetime.

    Shared by MPC and hosted-tiler registration so both register the identical search.
    """
    if not search_query:
        raise ValueError(
            "search_query is required for registration. "
            "The frontend must provide the full CQL2-JSON query."
        )
    body = copy.deepcopy(search_query)
    body["bbox"] = bbox
    _inject_datetime_into_query(
        body,
        f"{db_slice.start_date}T00:00:00Z",
        f"{db_slice.end_date}T23:59:59Z",
    )
    body.setdefault("filterLang", "cql2-json")
    return body


def _register_mpc_slice(stac, db_slice, bbox: list[float], search_query: dict | None = None) -> str:
    """Register a single slice mosaic via MPC's own tiler. Returns its searchid."""
    body = _resolved_search_body(search_query, bbox, db_slice)
    resp = httpx.post(MPC_REGISTER_URL, json=body, timeout=30)
    resp.raise_for_status()
    search_id: str = resp.json()["searchid"]
    return search_id


def _register_hosted_slice(stac, db_slice, bbox, search_query, tile_scope: str, tiler) -> str:
    """Ingest the slice's AOI into the hosted tiler's pgstac, then register the search.

    Returns the tiler's search id. The tiler runs the ingest server-side (the backend never
    writes to the tiler DB); ingest is skipped for tilers that serve only pre-loaded data.
    """
    dt_range = f"{db_slice.start_date}T00:00:00Z/{db_slice.end_date}T23:59:59Z"
    if tiler.allows_ingest:
        providers.ingest_on_tiler(
            tiler,
            stac.catalog_url,
            stac.stac_collection_id,
            bbox,
            dt_range,
            stac.max_cloud_cover,
        )
    body = _resolved_search_body(search_query, bbox, db_slice)
    return providers.register_on_tiler(
        tiler, body, tile_scope, internal_storage=stac.internal_storage
    )


def _inject_datetime_into_query(body: dict, start: str, end: str) -> None:
    """Replace datetime placeholders in a CQL2-JSON filter body,
    or inject a datetime filter if none exists."""
    body_str = json.dumps(body)
    if "{sliceStart}" in body_str or "{sliceEnd}" in body_str:
        body_str = body_str.replace("{sliceStart}", start)
        body_str = body_str.replace("{sliceEnd}", end)
        body.clear()
        body.update(json.loads(body_str))
        return

    # If no placeholder, ensure datetime is set at top level for pystac_client compatibility
    if "datetime" not in body:
        body["datetime"] = f"{start}/{end}"


def re_register_stac_collections(db: Session, campaign_id: int, bbox: list[float]) -> int:
    """Re-register every stac_browser collection in a campaign with a new bbox.

    Returns the number of collections updated.
    """

    sources = (
        db.execute(select(ImagerySource).where(ImagerySource.campaign_id == campaign_id))
        .scalars()
        .all()
    )

    updated = 0
    for source in sources:
        for collection in source.collections:
            stac = collection.stac_config
            if not stac or not stac.catalog_url:
                continue

            slices = (
                db.execute(
                    select(ImagerySlice)
                    .where(ImagerySlice.collection_id == collection.id)
                    .order_by(ImagerySlice.display_order)
                )
                .scalars()
                .all()
            )
            if not slices:
                continue

            collection_updated = False
            for sl_idx, sl in enumerate(slices):
                is_cover = collection.has_dedicated_cover and sl_idx == collection.cover_slice_index
                custom_query = (
                    stac.cover_search_query
                    if (is_cover and stac.cover_search_query)
                    else stac.search_query
                )

                # Register once per provider this slice uses (shared across its vizs); "mpc"
                # or a configured tiler name. Each provider is isolated so one failing
                # doesn't drop the other.
                refs: dict[str, str] = {}
                for provider in {tu.tile_provider for tu in sl.tile_urls if tu.tile_provider}:
                    try:
                        if provider == "mpc":
                            refs[provider] = _register_mpc_slice(stac, sl, bbox, custom_query)
                        else:
                            refs[provider] = _register_hosted_slice(
                                stac,
                                sl,
                                bbox,
                                custom_query,
                                str(campaign_id),
                                providers.resolve_tiler(provider),
                            )
                    except Exception:
                        logger.warning(
                            "STAC re-registration failed for collection %s slice %s provider %s",
                            collection.name,
                            sl.name,
                            provider,
                            exc_info=True,
                        )

                # Rebuild each visualization's URL with its own params + the slice's new ref.
                for tu in sl.tile_urls:
                    ref = refs.get(tu.tile_provider or "")
                    if ref is None:
                        continue
                    params = _slice_viz_params(stac, tu.visualization_name, is_cover)
                    if tu.tile_provider == "mpc":
                        tu.tile_url = providers.build_tile_url(
                            "mpc", ref, params, collection_id=stac.stac_collection_id
                        )
                    else:
                        tu.tile_url = providers.build_tile_url(
                            "hosted", ref, params, tiler=providers.resolve_tiler(tu.tile_provider)
                        )
                    tu.mosaic_id = ref
                    collection_updated = True

            if collection_updated:
                updated += 1

    return updated


def load_refreshable_collection(
    db: Session, collection_id: int, campaign_id: int
) -> ImageryCollection:
    """Look up a collection scoped to its owning campaign and validate it's
    refreshable, raising the 404/400 this has always raised for a bad id or a
    non-STAC-browser collection.

    The join through ImagerySource.campaign_id keeps this scoped to the caller's
    authorized campaign, so an admin of one campaign can't refresh (and
    re-ingest with their own bbox) a collection belonging to another.

    Shared by the request handler's synchronous pre-spawn check and
    refresh_collection_imagery's own use below, so there is one source of truth
    for what "refreshable" means rather than two copies that could drift.
    """
    collection = db.execute(
        select(ImageryCollection)
        .join(ImagerySource, ImageryCollection.source_id == ImagerySource.id)
        .where(
            ImageryCollection.id == collection_id,
            ImagerySource.campaign_id == campaign_id,
        )
    ).scalar_one_or_none()
    if not collection or not collection.stac_config:
        raise HTTPException(status_code=404, detail="Collection not found or no STAC config")

    stac = collection.stac_config
    if not stac.catalog_url or not stac.stac_collection_id:
        raise HTTPException(status_code=400, detail="Collection is not a STAC browser collection")
    return collection


def refresh_collection_imagery(
    db: Session,
    collection_id: int,
    campaign_id: int,
    bbox: list[float],
) -> dict:
    """Re-search STAC catalog with stored params, update mosaic items.

    Returns dict with status and registered_at.
    """
    collection = load_refreshable_collection(db, collection_id, campaign_id)
    stac = collection.stac_config
    # load_refreshable_collection already raised if any of this were falsy.
    assert stac is not None  # noqa: S101
    assert stac.catalog_url and stac.stac_collection_id  # noqa: S101
    slices = (
        db.execute(
            select(ImagerySlice)
            .where(ImagerySlice.collection_id == collection.id)
            .order_by(ImagerySlice.display_order)
        )
        .scalars()
        .all()
    )

    refreshed_count = 0
    for sl in slices:
        # Re-ingest the slice's AOI into the hosted tiler's pgstac; the registered search
        # auto-picks-up new items, so the tile URL is unchanged. MPC manages its own; direct
        # URLs and ingest-incapable tilers (pre-loaded data) have nothing to refresh.
        hosted_tu = next(
            (
                tu
                for tu in sl.tile_urls
                if tu.tile_provider and tu.tile_provider != "mpc" and tu.mosaic_id
            ),
            None,
        )
        if not hosted_tu:
            continue
        tiler = providers.resolve_tiler(hosted_tu.tile_provider)
        if not tiler.allows_ingest:
            continue

        dt_range = f"{sl.start_date}T00:00:00Z/{sl.end_date}T23:59:59Z"
        try:
            providers.ingest_on_tiler(
                tiler,
                stac.catalog_url,
                stac.stac_collection_id,
                bbox,
                dt_range,
                stac.max_cloud_cover,
            )
            refreshed_count += 1
        except Exception:
            logger.warning("Refresh failed for slice %s", sl.name, exc_info=True)

    db.flush()
    return {
        "status": "refreshed",
        "slices_updated": refreshed_count,
        "registered_at": datetime.utcnow().isoformat(),
    }
