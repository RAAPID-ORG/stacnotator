"""Registration: giving every STAC slice the mosaics its visualizations are drawn from.

What is missing is read off the rows (``tiles.missing_providers``): a save that changes
a search drops the mosaics it made stale, and the next run registers whatever is
missing, against MPC or a hosted tiler, in parallel and off the request path. A source
refresh re-ingests what a hosted tiler already holds.

Planet scene sources register nothing: a search is bounded by an area, and theirs
is wherever an annotator is standing - see ``service.search_planet_scenes_in_view``.
"""

import copy
import json
import logging
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from contextlib import ExitStack
from dataclasses import dataclass, replace
from functools import partial

import httpx
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from src import background, storage_access
from src.campaigns.models import Campaign
from src.imagery import tiles
from src.imagery.models import ImageryCollection, ImagerySlice, ImagerySource, SliceMosaic
from src.layers import LayerOwner
from src.redact import redact_urls
from src.storage_access import StorageAccess
from src.tilers import providers, registry
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
class MosaicOrder:
    """One mosaic to register: a slice's search on one provider. Plain data, taken
    before the read transaction is released, so the parallel calls never touch a
    session-bound object."""

    slice_id: int
    layer: str
    slice_name: str
    collection_name: str
    start_date: str
    end_date: str
    provider: str | None
    catalog_url: str
    stac_collection_id: str
    search_query: dict | None
    internal_storage: bool
    storage_access: StorageAccess | None

    @property
    def datetime_range(self) -> str:
        return f"{self.start_date}T00:00:00Z/{self.end_date}T23:59:59Z"


def missing_mosaics(sources: list[ImagerySource]) -> list[MosaicOrder]:
    """Every mosaic these sources' STAC slices need and do not have."""
    orders = []
    for source in sources:
        for collection in source.collections:
            if not collection.is_stac:
                continue
            assert collection.catalog_url and collection.stac_collection_id  # noqa: S101
            access = storage_access.stored(collection)
            for sl in collection.slices:
                for provider in sorted(tiles.missing_providers(collection, sl), key=str):
                    orders.append(
                        MosaicOrder(
                            slice_id=sl.id,
                            layer=source.tile_layer,
                            slice_name=sl.name,
                            collection_name=collection.name,
                            start_date=sl.start_date,
                            end_date=sl.end_date,
                            provider=provider,
                            catalog_url=collection.catalog_url,
                            stac_collection_id=collection.stac_collection_id,
                            search_query=copy.deepcopy(tiles.search_query(collection, sl)),
                            internal_storage=collection.internal_storage,
                            storage_access=access,
                        )
                    )
    return orders


def drop_mosaics(sources: list[ImagerySource]) -> None:
    """Forget every mosaic of these sources - for when the area they were searched
    over has moved. Does not flush."""
    for source in sources:
        for collection in source.collections:
            for sl in collection.slices:
                sl.mosaics.clear()


def _owner_sources(db: Session, owner: LayerOwner) -> list[ImagerySource]:
    """The owner's sources with everything ``missing_mosaics`` reads, in a few queries
    rather than one per slice."""
    column = (
        ImagerySource.campaign_id if owner.campaign_id is not None else ImagerySource.visualizer_id
    )
    owner_id = owner.campaign_id if owner.campaign_id is not None else owner.visualizer_id
    return list(
        db.scalars(
            select(ImagerySource)
            .where(column == owner_id)
            .options(
                selectinload(ImagerySource.collections).options(
                    selectinload(ImageryCollection.visualizations),
                    selectinload(ImageryCollection.slices).selectinload(ImagerySlice.mosaics),
                )
            )
        )
    )


def register_missing(db: Session, owner: LayerOwner, bbox: list[float]) -> list[dict]:
    """Register every mosaic the owner's slices are missing, in parallel with retries.
    Returns an error per mosaic that could not be registered.

    The read transaction is released before the slow provider calls and a new one
    writes the results - otherwise it sits idle across the calls and Postgres reaps it
    at idle_in_transaction_session_timeout.
    """
    MAX_WORKERS = 16
    MAX_RETRIES = 2

    orders = missing_mosaics(_owner_sources(db, owner))
    if not orders:
        return []
    errors: list[dict] = []

    def error(order: MosaicOrder, message: str) -> None:
        errors.append(
            {
                "collection": order.collection_name,
                "slice": order.slice_name,
                "datetime": order.datetime_range,
                "error": message,
            }
        )

    tilers: dict[str, providers.TilerCfg] = {}
    runnable: list[tuple[MosaicOrder, providers.TilerCfg | None]] = []
    for order in orders:
        if order.provider == registry.MPC:
            runnable.append((order, None))
        elif order.provider is None:
            error(order, "No tiler is configured to serve this collection")
        else:
            if order.provider not in tilers:
                try:
                    tilers[order.provider] = providers.resolve_tiler(order.provider)
                except ValueError:
                    error(order, f"Unknown tiler '{order.provider}'")
                    continue
            runnable.append((order, tilers[order.provider]))

    logger.info("Registering %d mosaics", len(runnable))
    db.commit()

    def register(work: tuple[MosaicOrder, providers.TilerCfg | None]) -> str | None:
        order, tiler = work
        for attempt in range(MAX_RETRIES + 1):
            try:
                if tiler is None:
                    return _register_mpc(order, bbox)
                return _register_hosted(order, bbox, owner.tile_scope, tiler)
            except Exception as e:
                if attempt < MAX_RETRIES:
                    time.sleep(1 * (attempt + 1))
                    continue
                logger.warning(
                    "Registering %s slice %s on %s failed after %d retries",
                    order.collection_name,
                    order.slice_name,
                    order.provider,
                    MAX_RETRIES,
                    exc_info=True,
                )
                error(order, _sanitize_stac_error(e))
        return None

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        mosaic_ids = list(pool.map(register, runnable))

    registered = [(o, m) for (o, _), m in zip(runnable, mosaic_ids, strict=True) if m is not None]
    logger.info("Registered %d/%d mosaics", len(registered), len(orders))
    # The slices may have changed while the searches were out: one deleted, a search
    # edited (that save started a run of its own), or the mosaic registered by another
    # run. A result is kept only where the same search is still missing.
    still_missing = {
        (o.slice_id, o.provider): o for o in missing_mosaics(_owner_sources(db, owner))
    }
    for order, mosaic_id in registered:
        current = still_missing.get((order.slice_id, order.provider))
        if current is not None and _same_search(current, order):
            db.merge(
                SliceMosaic(slice_id=order.slice_id, provider=order.provider, mosaic_id=mosaic_id)
            )
    return errors


def _same_search(a: MosaicOrder, b: MosaicOrder) -> bool:
    """Whether two orders search the same thing; the names are only labels."""
    return replace(a, slice_name="", collection_name="") == replace(
        b, slice_name="", collection_name=""
    )


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


def spawn_background_registration(owner: LayerOwner, bbox: list[float]) -> None:
    """Register what the owner is missing off the request path (see src/background.py):
    the provider calls are many and slow, and inline they would hold the request's
    write transaction open."""
    row_id, status_field = status_run_for(owner)
    background.spawn_status_run(
        row_id,
        status_field,
        name="imagery registration",
        work=lambda db: register_missing(db, owner, bbox),
        sanitize_error=lambda exc: f"Imagery registration: {_sanitize_stac_error(exc)}",
    )


def resume_pending(db: Session) -> None:
    """Start the registration runs left owed, for the owners this worker claims.

    One thread works through them in turn rather than a run per owner at once, so a
    deploy that owes many does not send them all at the tiler together. Every claimed
    run beats from the start, so none is swept as dead while it waits its turn.
    """
    claimed = [
        *((i, REGISTRATION_RUN) for i in background.claim_pending_runs(db, REGISTRATION_RUN)),
        *(
            (i, VISUALIZER_REGISTRATION_RUN)
            for i in background.claim_pending_runs(db, VISUALIZER_REGISTRATION_RUN)
        ),
    ]
    db.commit()
    if claimed:
        threading.Thread(target=_register_in_turn, args=(claimed,), daemon=True).start()


def _register_in_turn(claimed: list[tuple[int, background.StatusField]]) -> None:
    with ExitStack() as beating:
        for row_id, field in claimed:
            beating.enter_context(background.heartbeat(row_id, field))
        for row_id, field in claimed:
            background.run_status_run(
                row_id,
                field,
                name="imagery registration",
                work=partial(_register_owner, row_id=row_id, field=field),
                sanitize_error=lambda exc: f"Imagery registration: {_sanitize_stac_error(exc)}",
            )


def _register_owner(db: Session, row_id: int, field: background.StatusField) -> list[dict]:
    row = db.get(Campaign, row_id) if field is REGISTRATION_RUN else db.get(Visualizer, row_id)
    if row is None:
        return []
    return register_missing(db, row.layer_owner, list(row.bbox))


def commit_and_register(db: Session, owner: Campaign | Visualizer, bbox) -> None:
    """Commit the caller's writes and, when a mosaic is missing, start the run that
    registers it.

    The run's start is committed with the writes that made it necessary, before the
    thread spawns, and clears the errors a past run left so they don't sit under the
    new one.
    """
    db.flush()
    if not missing_mosaics(_owner_sources(db, owner.layer_owner)):
        db.commit()
        return
    _, field = status_run_for(owner.layer_owner)
    background.begin_status_run(owner, field)
    owner.registration_errors = None
    db.commit()
    spawn_background_registration(owner.layer_owner, list(bbox))


def refreshable_collection_ids(db: Session, source_id: int, campaign_id: int) -> list[int]:
    """Every collection of this campaign source whose STAC search can be re-run, in
    display order. 404s for a source outside the campaign, 400s when the source holds
    nothing re-searchable (a manual-URL source has no catalog to ask again)."""
    source = db.get(ImagerySource, source_id)
    if source is None or source.campaign_id != campaign_id:
        raise HTTPException(status_code=404, detail="Source not found")
    ids = [c.id for c in source.collections if c.is_stac and c.slices]
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


def _resolved_search_body(order: MosaicOrder, bbox: list[float]) -> dict:
    """The slice's CQL2-JSON query with the area and its dates filled in. MPC and a
    hosted tiler register the identical search."""
    if not order.search_query:
        raise ValueError("A STAC collection needs a search query to register")
    body = copy.deepcopy(order.search_query)
    body["bbox"] = bbox
    _inject_datetime_into_query(
        body, f"{order.start_date}T00:00:00Z", f"{order.end_date}T23:59:59Z"
    )
    body.setdefault("filterLang", "cql2-json")
    return body


def _register_mpc(order: MosaicOrder, bbox: list[float]) -> str:
    """Register the slice's search with MPC's own tiler. Returns its searchid."""
    resp = httpx.post(MPC_REGISTER_URL, json=_resolved_search_body(order, bbox), timeout=30)
    resp.raise_for_status()
    search_id: str = resp.json()["searchid"]
    return search_id


def _register_hosted(
    order: MosaicOrder, bbox: list[float], tile_scope: str, tiler: providers.TilerCfg
) -> str:
    """Ingest the slice's area into the hosted tiler's pgstac, then register the search.

    The tiler runs the ingest server-side (the backend never writes to the tiler DB);
    ingest is skipped for tilers that serve only pre-loaded data. A private catalog is
    ingested with its access into a pgstac collection of its own, so the search names that
    collection and carries the access, sealed, for the tiler to read its assets with.
    """
    body = _resolved_search_body(order, bbox)
    access = order.storage_access
    if access is not None:
        if not tiler.allows_ingest:
            raise ValueError("A private catalog needs a tiler that can ingest it")
        body["collections"] = [
            providers.ingest_on_tiler(
                tiler,
                order.catalog_url,
                order.stac_collection_id,
                bbox,
                order.datetime_range,
                tiles.cloud_cover_ceiling(order.search_query),
                storage_access=access.tiler_body(),
            )
        ]
        return providers.register_on_tiler(
            tiler,
            body,
            tile_scope,
            order.layer,
            sealed_storage_access=storage_access.seal_for_tiler(access, order.catalog_url),
        )
    if tiler.allows_ingest:
        providers.ingest_on_tiler(
            tiler,
            order.catalog_url,
            order.stac_collection_id,
            bbox,
            order.datetime_range,
            tiles.cloud_cover_ceiling(order.search_query),
        )
    return providers.register_on_tiler(
        tiler, body, tile_scope, order.layer, internal_storage=order.internal_storage
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


def _reingest_collection(collection: ImageryCollection, bbox: list[float]) -> None:
    """Re-ingest each hosted slice's area so its registered search picks up newer items.

    The tile URL stays the same. MPC manages its own catalog, and direct URLs and
    ingest-incapable tilers (pre-loaded data) have nothing to re-ingest.
    """
    assert collection.catalog_url and collection.stac_collection_id  # noqa: S101
    access = storage_access.stored(collection)
    for sl in collection.slices:
        hosted = next((m for m in sl.mosaics if m.provider != registry.MPC), None)
        if hosted is None:
            continue
        tiler = providers.resolve_tiler(hosted.provider)
        if not tiler.allows_ingest:
            continue
        try:
            providers.ingest_on_tiler(
                tiler,
                collection.catalog_url,
                collection.stac_collection_id,
                bbox,
                f"{sl.start_date}T00:00:00Z/{sl.end_date}T23:59:59Z",
                tiles.cloud_cover_ceiling(tiles.search_query(collection, sl)),
                storage_access=access.tiler_body() if access else None,
            )
        except Exception:
            logger.warning("Refresh failed for slice %s", sl.name, exc_info=True)
