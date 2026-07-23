"""Mosaic registration against STAC providers (MPC direct or hosted tilers).

Owns everything that talks to the outside world to turn stored collections into
servable tile URLs: the parallel slice registration with retries, the background
thread that runs it off the request path, bbox-change re-registration, and the
manual refresh endpoint's re-ingest. Editor-state persistence lives in
``service.py``; it only hands over ``pending_registrations`` tuples.
"""

import copy
import json
import logging
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from datetime import datetime

import httpx
from fastapi import HTTPException
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from src.config import get_settings
from src.database import SessionLocal
from src.imagery.models import ImageryCollection, ImagerySlice, ImagerySource, SliceTileUrl
from src.imagery.tile_urls import _slice_viz_params
from src.tilers import providers

logger = logging.getLogger(__name__)

MPC_REGISTER_URL = "https://planetarycomputer.microsoft.com/api/data/v1/mosaic/register"


def _sanitize_stac_error(e: Exception) -> str:
    """Extract a user-facing error message from a STAC registration exception.

    Only exposes information about the STAC query / HTTP response, never
    internal paths, credentials, or stack traces.
    """
    if isinstance(e, HTTPException):
        # register_mosaic_sync raises HTTPException with a curated detail
        # (e.g. "No items found ..."); surface the detail alone.
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
    # Generic: only expose the exception type + first line
    msg = str(e).split("\n")[0]
    # Strip file paths
    if "/" in msg and ("site-packages" in msg or "/app/" in msg):
        return f"Registration failed ({type(e).__name__})"
    return msg[:200] if msg else f"Registration failed ({type(e).__name__})"


@dataclass(frozen=True)
class _SliceRef:
    """Plain snapshot of the slice fields registration needs. Captured before the
    read transaction is released so the parallel-HTTP phase never dereferences a
    session-bound ORM object (which would reopen a transaction, off-thread)."""

    id: int
    name: str
    start_date: str
    end_date: str


def _register_all_stac_browser_collections(
    db: Session,
    pending: list[tuple],
    bbox: list[float],
    campaign_id: int,
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
    for collection, col_create, src_create in pending:
        stac = col_create.stac_config

        # Validate viz name parity between source and stac_config
        source_names = [v.name for v in src_create.visualizations]
        stac_names = [v.name for v in stac.visualizations]
        if set(source_names) != set(stac_names):
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Visualization name mismatch in collection '{collection.name}': "
                    f"source has {source_names}, stac_config has {stac_names}"
                ),
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
                .where(ImagerySlice.collection_id == collection.id)
                .order_by(ImagerySlice.display_order)
            )
            .scalars()
            .all()
        )

        for sl_idx, db_slice in enumerate(db_slices):
            is_cover = col_create.has_dedicated_cover and sl_idx == col_create.cover_slice_index

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
                    "collection_name": collection.name,
                    "tiler_name": stac.tiler or get_settings().DEFAULT_TILER,
                    "search_query": cover_search_query
                    if (is_cover and cover_search_query)
                    else search_query,
                }
            )

    if not tasks:
        return []

    # Resolve each hosted tiler once; MPC-only collections resolve none.
    tilers_by_name: dict[str, object] = {}
    for name in {t["tiler_name"] for t in tasks if t["any_needs_hosted"]}:
        try:
            tilers_by_name[name] = providers.resolve_tiler(name)
        except ValueError:
            raise HTTPException(status_code=400, detail=f"Unknown tiler '{name}'") from None

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
                    campaign_id,
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
    logger.info("Mosaic registration complete: %d/%d slices succeeded", succeeded, len(tasks))

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


_STATUS_FIELDS = {"registration_status", "embedding_status"}


def finish_registration(
    db: Session,
    campaign_id: int,
    *,
    status_field: str,
    status: str,
    errors: list[dict],
) -> None:
    """Atomically flip a campaign's status field and append to registration_errors.

    The mosaic thread and the embeddings thread can each finish the same campaign
    around the same time. A read-modify-write on registration_errors (read the
    list, append in Python, write the whole list back) lets whichever thread
    commits second silently overwrite the other's errors. This does the append
    inside the UPDATE itself, so both threads' errors survive no matter which
    commits first - the single writer of registration_errors is this statement.

    Does not commit; the caller commits alongside whatever else it writes in the
    same transaction.
    """
    if status_field not in _STATUS_FIELDS:
        raise ValueError(f"Unknown status_field: {status_field!r}")

    # SessionLocal runs with autoflush=False: flush any ORM writes already staged
    # on this session, or this Core statement could run without seeing them.
    db.flush()
    db.execute(
        text(
            "UPDATE data.campaigns "
            "SET registration_errors = coalesce(registration_errors, '[]'::jsonb) "
            "        || cast(:new_errors AS jsonb), "
            f"    {status_field} = :status "
            "WHERE id = :campaign_id"
        ),
        {
            "new_errors": json.dumps(errors),
            "status": status,
            "campaign_id": campaign_id,
        },
    )


def spawn_background_mosaic_registration(
    campaign_id: int,
    pending_registrations: list[tuple],
    bbox: list[float],
) -> None:
    """Run mosaic registration on a daemon thread with its own DB session.

    Registration makes many slow parallel STAC calls; doing it inline holds the
    request's write transaction open across them and trips the
    idle-in-transaction backstop. The request commits the entity reconciliation
    (and marks the campaign `registering`) first, then calls this to rebuild the
    tile URLs and flip `registration_status` to ready/failed when done.

    Collection ids are captured now, while the ORM objects are still attached to
    the request session; the thread re-fetches them against its own session so
    it never touches a detached or cross-thread instance.
    """
    reg_specs = [
        (col.id, col_create, src_create) for col, col_create, src_create in pending_registrations
    ]

    def _run() -> None:
        bg_db = SessionLocal()
        try:
            logger.info("Background mosaic registration started for campaign %d", campaign_id)
            pending = [
                (col, col_create, src_create)
                for col_id, col_create, src_create in reg_specs
                if (col := bg_db.get(ImageryCollection, col_id)) is not None
            ]
            errors = _register_all_stac_browser_collections(bg_db, pending, bbox, campaign_id)
            finish_registration(
                bg_db,
                campaign_id,
                status_field="registration_status",
                status="failed" if errors else "ready",
                errors=errors,
            )
            bg_db.commit()
            if errors:
                logger.warning(
                    "Mosaic registration for campaign %d: %d errors", campaign_id, len(errors)
                )
            else:
                logger.info("Mosaic registration completed for campaign %d", campaign_id)
        except Exception as exc:
            logger.exception("Mosaic registration failed for campaign %d", campaign_id)
            try:
                finish_registration(
                    bg_db,
                    campaign_id,
                    status_field="registration_status",
                    status="failed",
                    errors=[{"error": f"Mosaic registration: {_sanitize_stac_error(exc)}"}],
                )
                bg_db.commit()
            except Exception:
                logger.warning("Failed to persist registration error status", exc_info=True)
        finally:
            bg_db.close()

    threading.Thread(target=_run, daemon=True).start()


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
    return resp.json()["searchid"]


def _register_hosted_slice(stac, db_slice, bbox, search_query, campaign_id, tiler) -> str:
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
        tiler, body, campaign_id, internal_storage=stac.internal_storage
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
                                campaign_id,
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
                    ref = refs.get(tu.tile_provider)
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


def refresh_collection_imagery(
    db: Session,
    collection_id: int,
    bbox: list[float],
) -> dict:
    """Re-search STAC catalog with stored params, update mosaic items.

    Returns dict with status and registered_at.
    """
    collection = db.execute(
        select(ImageryCollection).where(ImageryCollection.id == collection_id)
    ).scalar_one_or_none()
    if not collection or not collection.stac_config:
        raise HTTPException(status_code=404, detail="Collection not found or no STAC config")

    stac = collection.stac_config
    if not stac.catalog_url or not stac.stac_collection_id:
        raise HTTPException(status_code=400, detail="Collection is not a STAC browser collection")

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
