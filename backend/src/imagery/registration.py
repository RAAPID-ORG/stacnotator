"""Registration: turning stored collections into servable tile URLs.

Owns everything that talks to the outside world for that: parallel slice
registration against STAC providers (MPC direct or hosted tilers) with retries,
the background thread that runs it off the request path, bbox-change
re-registration, and a source refresh's re-ingest. Editor-state
persistence lives in ``service.py``; it only hands over plain snapshots.

Planet scene sources register nothing: a search is bounded by an area, and theirs
is wherever an annotator is standing - see ``service.search_planet_scenes_in_view``.
"""

import copy
import json
import logging
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass

import httpx
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from src import background, storage_access
from src.campaigns.models import Campaign
from src.config import get_settings
from src.imagery.models import (
    ImageryCollection,
    ImagerySlice,
    ImagerySource,
    SliceTileUrl,
)
from src.imagery.schemas import (
    CollectionStacConfigCreate,
    NamedVizParamsCreate,
    VizParamsCreate,
)
from src.layers import LayerOwner
from src.redact import redact_urls
from src.storage_access import StorageAccess
from src.tilers import providers
from src.visualizers.models import Visualizer

logger = logging.getLogger(__name__)

MPC_REGISTER_URL = "https://planetarycomputer.microsoft.com/api/data/v1/mosaic/register"


def sanitize_error_message(exc: Exception, *, fallback: str) -> str:
    """Generic-exception sanitizing tail shared by the mosaic and embedding paths.

    Only exposes the exception type + first line, never internal paths,
    credentials, or stack traces.
    """
    msg = redact_urls(str(exc)).split("\n")[0]
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
    """A work order for one STAC collection, built by the imagery-editor save flow when
    the collection is created or its search-affecting fields change. Plain data because
    the background thread must never touch a request-scoped ORM object."""

    collection_id: int
    collection_name: str
    stac_config: CollectionStacConfigCreate
    has_dedicated_cover: bool
    cover_slice_index: int
    source_viz_names: list[str]
    # A private catalog's access, decrypted from the collection's stored one.
    storage_access: StorageAccess | None = None


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
                    "storage_access": spec.storage_access,
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
                    task["storage_access"],
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


# The imagery domain's background run: registration and source
# refresh both report through this status/heartbeat pair on the campaign.
REGISTRATION_RUN = background.StatusField(
    model=Campaign,
    status_column="registration_status",
    heartbeat_column="registration_heartbeat_at",
    errors_column="registration_errors",
    interrupted_error=(
        "Imagery registration was interrupted by a server restart. "
        "Save the imagery again or refresh the affected source to retry."
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
    pending: list[StacRegistrationSpec],
    bbox: list[float],
) -> None:
    """Run registration off the request path (see src/background.py).

    Registration makes many slow parallel provider calls; inline they hold the
    request's write transaction open and trip the idle-in-transaction backstop. The
    request commits the entity reconciliation (and begin_status_run) first, then calls
    this to rebuild the tile URLs and flip `registration_status` when done.

    """
    row_id, status_field = status_run_for(owner)

    def work(db: Session) -> list[dict]:
        return _register_all_stac_browser_collections(db, pending, bbox, owner.tile_scope)

    background.spawn_status_run(
        row_id,
        status_field,
        name="imagery registration",
        work=work,
        sanitize_error=lambda exc: f"Imagery registration: {_sanitize_stac_error(exc)}",
    )


def commit_and_register(
    db: Session, owner: Campaign | Visualizer, pending: list[StacRegistrationSpec], bbox
) -> None:
    """Commit the caller's writes and, when there is anything to register, start the run.

    The run's start is committed with the writes that made it necessary, before the
    thread spawns, and clears the errors a past run left so they don't sit under the
    new one.
    """
    if not pending:
        db.commit()
        return
    _, field = status_run_for(owner.layer_owner)
    background.begin_status_run(owner, field)
    owner.registration_errors = None
    db.commit()
    spawn_background_registration(owner.layer_owner, pending, list(bbox))


def refreshable_collection_ids(db: Session, source_id: int, campaign_id: int) -> list[int]:
    """Every collection of this campaign source whose STAC search can be re-run, in
    display order. 404s for a source outside the campaign, 400s when the source holds
    nothing re-searchable (a manual-URL source has no catalog to ask again)."""
    source = db.get(ImagerySource, source_id)
    if source is None or source.campaign_id != campaign_id:
        raise HTTPException(status_code=404, detail="Source not found")
    ids = [c.id for c in source.collections if stored_spec(c) is not None]
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
            collection = db.get(ImageryCollection, collection_id)
            if collection is not None:
                _reingest_collection(collection, bbox)

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


def _register_hosted_slice(
    stac,
    db_slice,
    bbox,
    search_query,
    tile_scope: str,
    tiler,
    access: StorageAccess | None = None,
) -> str:
    """Ingest the slice's AOI into the hosted tiler's pgstac, then register the search.

    Returns the tiler's search id. The tiler runs the ingest server-side (the backend never
    writes to the tiler DB); ingest is skipped for tilers that serve only pre-loaded data.

    A private catalog (``access``) is ingested with its access into a pgstac collection of
    its own, so the search is pointed at that collection and carries the access, sealed,
    for the tiler to read its assets with.
    """
    dt_range = f"{db_slice.start_date}T00:00:00Z/{db_slice.end_date}T23:59:59Z"
    body = _resolved_search_body(search_query, bbox, db_slice)
    if access is not None:
        if not tiler.allows_ingest:
            raise ValueError("A private catalog needs a tiler that can ingest it")
        pgstac_collection = providers.ingest_on_tiler(
            tiler,
            stac.catalog_url,
            stac.stac_collection_id,
            bbox,
            dt_range,
            stac.max_cloud_cover,
            storage_access=access.tiler_body(),
        )
        body["collections"] = [pgstac_collection]
        return providers.register_on_tiler(
            tiler,
            body,
            tile_scope,
            sealed_storage_access=storage_access.seal_for_tiler(access, stac.catalog_url),
        )
    if tiler.allows_ingest:
        providers.ingest_on_tiler(
            tiler,
            stac.catalog_url,
            stac.stac_collection_id,
            bbox,
            dt_range,
            stac.max_cloud_cover,
        )
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


def stored_spec(collection: ImageryCollection) -> StacRegistrationSpec | None:
    """The work order to register this collection as it is stored, or None when it
    holds no STAC search to register (a manual-URL collection, or one with no slices)."""
    stac = collection.stac_config
    if not (stac and stac.catalog_url and stac.stac_collection_id and collection.slices):
        return None
    return StacRegistrationSpec(
        collection_id=collection.id,
        collection_name=collection.name,
        stac_config=CollectionStacConfigCreate(
            catalog_url=stac.catalog_url,
            stac_collection_id=stac.stac_collection_id,
            tiler=stac.tile_provider,
            max_cloud_cover=stac.max_cloud_cover,
            search_query=copy.deepcopy(stac.search_query),
            cover_search_query=copy.deepcopy(stac.cover_search_query),
            internal_storage=stac.internal_storage,
            visualizations=[
                NamedVizParamsCreate(
                    name=vc.name,
                    viz_params=VizParamsCreate.model_validate(vc.render_params),
                    cover_viz_params=(
                        VizParamsCreate.model_validate(vc.cover_render_params)
                        if vc.cover_render_params is not None
                        else None
                    ),
                )
                for vc in collection.viz_configs
            ],
        ),
        has_dedicated_cover=collection.has_dedicated_cover,
        cover_slice_index=collection.cover_slice_index,
        source_viz_names=[v.name for v in collection.source.visualizations],
        storage_access=storage_access.stored(stac),
    )


def discard_for_registration(collection: ImageryCollection) -> StacRegistrationSpec | None:
    """Drop the collection's tile URLs and return the work order that rebuilds them.

    Does not flush or commit: the caller commits the deletes together with whatever
    made them stale, then hands the work orders to ``spawn_background_registration``.
    """
    spec = stored_spec(collection)
    if spec is not None:
        for sl in collection.slices:
            sl.tile_urls.clear()
    return spec


def prepare_reregistration(sources: list[ImagerySource]) -> list[StacRegistrationSpec]:
    """Every STAC collection of these sources, set to be registered again - for when the
    area they are searched over has moved."""
    return [
        spec
        for source in sources
        for collection in source.collections
        if (spec := discard_for_registration(collection)) is not None
    ]


def _reingest_collection(collection: ImageryCollection, bbox: list[float]) -> None:
    """Re-ingest each hosted slice's area so its registered search picks up newer items.

    The tile URL stays the same. MPC manages its own catalog, and direct URLs and
    ingest-incapable tilers (pre-loaded data) have nothing to re-ingest.
    """
    stac = collection.stac_config
    assert stac is not None and stac.catalog_url and stac.stac_collection_id  # noqa: S101
    access = storage_access.stored(stac)
    for sl in collection.slices:
        hosted = next(
            (tu for tu in sl.tile_urls if tu.tile_provider not in (None, "mpc") and tu.mosaic_id),
            None,
        )
        if hosted is None:
            continue
        tiler = providers.resolve_tiler(hosted.tile_provider)
        if not tiler.allows_ingest:
            continue
        try:
            providers.ingest_on_tiler(
                tiler,
                stac.catalog_url,
                stac.stac_collection_id,
                bbox,
                f"{sl.start_date}T00:00:00Z/{sl.end_date}T23:59:59Z",
                stac.max_cloud_cover,
                storage_access=access.tiler_body() if access else None,
            )
        except Exception:
            logger.warning("Refresh failed for slice %s", sl.name, exc_info=True)
