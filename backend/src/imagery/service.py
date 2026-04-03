import logging
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from src.campaigns.constants import DEFAULT_CAMPAIGN_MAIN_CANVAS_LAYOUT
from src.campaigns.models import Campaign, CampaignUser, CanvasLayout
from src.imagery.models import (
    Basemap,
    CollectionStacConfig,
    ImageryCollection,
    ImagerySlice,
    ImagerySource,
    ImageryView,
    MosaicItem,
    MosaicRegistration,
    SliceTileUrl,
    VisualizationTemplate,
)
from src.imagery.schemas import (
    BasemapCreate,
    CanvasLayoutCreate,
    ImageryEditorStateCreate,
    ImagerySourceCreate,
    ImageryViewCreate,
)
from src.imagery.stac_registration import register_collection_slices
from src.tiling.router import build_viz_query_string, register_mosaic_sync


def _bbox_to_wkt(west: float, south: float, east: float, north: float) -> str:
    """Convert bbox to WKT POLYGON for PostGIS ST_GeomFromText."""
    return (
        f"SRID=4326;POLYGON(({west} {south},{east} {south},"
        f"{east} {north},{west} {north},{west} {south}))"
    )


logger = logging.getLogger(__name__)


# ============================================================================
# Imagery Creation (new model)
# ============================================================================


def create_imagery_from_editor_state(
    db: Session,
    *,
    campaign: Campaign,
    editor_state: ImageryEditorStateCreate,
) -> dict:
    """
    Persist the full imagery editor state (sources, views, basemaps) for a campaign.
    Handles frontend-to-DB id mapping so views can reference DB-assigned collection/source ids.

    Returns dict with keys 'sources', 'views', 'basemaps' containing ORM objects.
    Does NOT commit - caller is responsible for commit.
    """
    if not campaign.settings:
        raise HTTPException(status_code=404, detail="Campaign settings not found")

    bbox = [
        campaign.settings.bbox_west,
        campaign.settings.bbox_south,
        campaign.settings.bbox_east,
        campaign.settings.bbox_north,
    ]

    # Mapping: frontend temp id -> DB id
    source_id_map: dict[str, int] = {}  # fe_source_id -> db source id
    collection_id_map: dict[str, int] = {}  # fe_collection_id -> db collection id

    # Track stac_browser collections that need mosaic registration
    pending_registrations: list[tuple[ImageryCollection, object, ImagerySourceCreate]] = []

    created_sources: list[ImagerySource] = []
    for src_idx, src_create in enumerate(editor_state.sources):
        source, pending = _create_source(db, campaign.id, src_create, src_idx, bbox)
        db.flush()

        # Build id map using index as frontend key (frontend sends ordered lists)
        source_id_map[str(src_idx)] = source.id
        for col_idx, col in enumerate(source.collections):
            collection_id_map[f"{src_idx}:{col_idx}"] = col.id

        pending_registrations.extend(pending)
        created_sources.append(source)

    created_basemaps = _create_basemaps(db, campaign.id, editor_state.basemaps)
    db.flush()

    created_views = _create_views(
        db,
        campaign.id,
        editor_state.views,
        editor_state.sources,
        source_id_map,
        collection_id_map,
    )
    db.flush()

    return {
        "sources": created_sources,
        "views": created_views,
        "basemaps": created_basemaps,
        "pending_registrations": pending_registrations,
        "bbox": bbox,
    }


def _create_source(
    db: Session,
    campaign_id: int,
    src: ImagerySourceCreate,
    src_idx: int,
    bbox: list[float],
) -> tuple[ImagerySource, list[tuple]]:
    """Create a single ImagerySource with all its children.
    Returns (source, pending_registrations)."""
    pending: list[tuple] = []
    source = ImagerySource(
        campaign_id=campaign_id,
        name=src.name,
        crosshair_hex6=src.crosshair_hex6,
        default_zoom=src.default_zoom,
        display_order=src_idx,
    )
    db.add(source)
    db.flush()

    # Visualization templates
    for viz_idx, viz in enumerate(src.visualizations):
        db.add(
            VisualizationTemplate(
                source_id=source.id,
                name=viz.name,
                display_order=viz_idx,
            )
        )

    # Collections
    for col_idx, col_create in enumerate(src.collections):
        collection = ImageryCollection(
            source_id=source.id,
            name=col_create.name,
            cover_slice_index=col_create.cover_slice_index,
            display_order=col_idx,
        )
        db.add(collection)
        db.flush()

        # STAC config
        if col_create.stac_config:
            # Capture viz URL templates (with {searchId} placeholders) so we can
            # re-register later when the campaign bbox changes.
            viz_url_templates = (
                [
                    {"viz_name": vu.visualization_name, "url_template": vu.tile_url}
                    for vu in col_create.slices[0].tile_urls
                ]
                if col_create.slices and col_create.slices[0].tile_urls
                else None
            )
            db.add(
                CollectionStacConfig(
                    collection_id=collection.id,
                    registration_url=col_create.stac_config.registration_url,
                    search_body=col_create.stac_config.search_body,
                    viz_url_templates=viz_url_templates,
                    catalog_url=col_create.stac_config.catalog_url,
                    stac_collection_id=col_create.stac_config.stac_collection_id,
                    viz_params=(
                        col_create.stac_config.viz_params.model_dump(exclude_none=True)
                        if col_create.stac_config.viz_params
                        else None
                    ),
                    cover_viz_params=(
                        col_create.stac_config.cover_viz_params.model_dump(exclude_none=True)
                        if col_create.stac_config.cover_viz_params
                        else None
                    ),
                    max_cloud_cover=col_create.stac_config.max_cloud_cover,
                    search_query=col_create.stac_config.search_query,
                    cover_search_query=col_create.stac_config.cover_search_query,
                )
            )

        # Slices
        for sl_idx, sl_create in enumerate(col_create.slices):
            slice_obj = ImagerySlice(
                collection_id=collection.id,
                name=sl_create.name,
                start_date=sl_create.start_date,
                end_date=sl_create.end_date,
                display_order=sl_idx,
            )
            db.add(slice_obj)
            db.flush()

            # Direct tile URLs (manual XYZ)
            for tile in sl_create.tile_urls:
                db.add(
                    SliceTileUrl(
                        slice_id=slice_obj.id,
                        visualization_name=tile.visualization_name,
                        tile_url=tile.tile_url,
                    )
                )

        # STAC registration: resolve tile URLs for all slices (old stac flow)
        if col_create.stac_config and col_create.slices and col_create.stac_config.registration_url:
            _register_stac_collection(db, collection, col_create, src, bbox)

        # Collect stac_browser collections for batch registration
        if (
            col_create.stac_config
            and col_create.stac_config.catalog_url
            and col_create.stac_config.stac_collection_id
            and col_create.slices
        ):
            pending.append((collection, col_create, src))

    db.flush()
    db.refresh(source)
    return source, pending


def _register_stac_collection(
    db: Session,
    collection: ImageryCollection,
    col_create,
    src_create: ImagerySourceCreate,
    bbox: list[float],
) -> None:
    """Register STAC mosaics for a collection's slices and persist resolved tile URLs."""
    stac = col_create.stac_config
    if not stac:
        return

    # Build viz URL templates from the collection data
    viz_templates = (
        [
            {"viz_name": vu.visualization_name, "url_template": vu.tile_url}
            for vu in col_create.slices[0].tile_urls
        ]
        if col_create.slices and col_create.slices[0].tile_urls
        else []
    )

    # If no tile_urls on slices, try to use viz URLs from the stac config's first slice
    # (the frontend sends viz URL templates as tile_urls with {searchId} placeholders)
    if not viz_templates:
        return

    slice_descriptors = [
        {"index": i, "start_date": s.start_date, "end_date": s.end_date}
        for i, s in enumerate(col_create.slices)
    ]

    try:
        results = register_collection_slices(
            registration_url=stac.registration_url,
            search_body=stac.search_body,
            bbox=bbox,
            slices=slice_descriptors,
            viz_url_templates=viz_templates,
        )

        # Persist resolved URLs
        db_slices = (
            db.query(ImagerySlice)
            .filter(ImagerySlice.collection_id == collection.id)
            .order_by(ImagerySlice.display_order)
            .all()
        )

        for result in results:
            idx = result["slice_index"]
            if idx < len(db_slices):
                # Clear any template URLs and replace with resolved ones
                db.query(SliceTileUrl).filter(SliceTileUrl.slice_id == db_slices[idx].id).delete()
                for tile in result["tile_urls"]:
                    db.add(
                        SliceTileUrl(
                            slice_id=db_slices[idx].id,
                            visualization_name=tile["viz_name"],
                            tile_url=tile["url"],
                        )
                    )
    except Exception:
        logger.warning(
            "STAC registration failed for collection %s - tile URLs left as templates",
            collection.name,
            exc_info=True,
        )


def _sanitize_stac_error(e: Exception) -> str:
    """Extract a user-facing error message from a STAC registration exception.

    Only exposes information about the STAC query / HTTP response, never
    internal paths, credentials, or stack traces.
    """
    import httpx

    if isinstance(e, httpx.HTTPStatusError):
        status = e.response.status_code
        # Try to extract a message from the response body
        try:
            body = e.response.json()
            detail = body.get("detail") or body.get("message") or body.get("description", "")
            if detail:
                return f"HTTP {status}: {detail}"
        except Exception:
            pass
        return f"HTTP {status} from tile server"
    if isinstance(e, ValueError):
        # Our own "No items found" errors are safe to surface
        return str(e)
    # Generic: only expose the exception type + first line
    msg = str(e).split("\n")[0]
    # Strip file paths
    if "/" in msg and ("site-packages" in msg or "/app/" in msg):
        return f"Registration failed ({type(e).__name__})"
    return msg[:200] if msg else f"Registration failed ({type(e).__name__})"


MPC_REGISTER_URL = "https://planetarycomputer.microsoft.com/api/data/v1/mosaic/register"
MPC_TILES_BASE = "https://planetarycomputer.microsoft.com/api/data/v1/mosaic/{searchId}/tiles/WebMercatorQuad/{z}/{x}/{y}"


def _register_all_stac_browser_collections(
    db: Session,
    pending: list[tuple],
    bbox: list[float],
) -> list[dict]:
    """Register mosaics for all stac_browser collections in parallel with retries.
    Returns a list of error dicts for failed slices (empty on full success).

    Persists MosaicRegistration + MosaicItem rows to DB and bakes viz params
    into the stored tile URLs so the frontend doesn't need to build them.
    """
    import time
    from concurrent.futures import ThreadPoolExecutor, as_completed
    from datetime import datetime as dt

    MAX_WORKERS = 16
    MAX_RETRIES = 2

    # Build a flat list of tasks
    tasks: list[dict] = []
    for collection, col_create, src_create in pending:
        stac = col_create.stac_config
        viz_names = [v.name for v in src_create.visualizations]
        is_mpc = "planetarycomputer.microsoft.com" in (stac.catalog_url or "")

        # Get viz params dicts for URL baking
        viz_params_dict = stac.viz_params.model_dump(exclude_none=True) if stac.viz_params else None
        cover_viz_params_dict = (
            stac.cover_viz_params.model_dump(exclude_none=True) if stac.cover_viz_params else None
        )
        # Custom search queries
        search_query = stac.search_query
        cover_search_query = stac.cover_search_query

        db_slices = (
            db.query(ImagerySlice)
            .filter(ImagerySlice.collection_id == collection.id)
            .order_by(ImagerySlice.display_order)
            .all()
        )

        for sl_idx, db_slice in enumerate(db_slices):
            is_cover = sl_idx == col_create.cover_slice_index

            # Determine tile provider per-slice: cover may use different compositing/masking
            slice_viz = (
                cover_viz_params_dict if (is_cover and cover_viz_params_dict) else viz_params_dict
            )
            slice_compositing = (slice_viz or {}).get("compositing")
            slice_has_masking = bool((slice_viz or {}).get("mask_layer"))
            # Use MPC directly only if: MPC catalog + first-valid compositing + no masking
            slice_use_mpc = (
                is_mpc
                and (not slice_compositing or slice_compositing == "first")
                and not slice_has_masking
            )

            tasks.append(
                {
                    "db_slice": db_slice,
                    "stac": stac,
                    "viz_names": viz_names,
                    "use_mpc": slice_use_mpc,
                    "collection_name": collection.name,
                    "is_cover": is_cover,
                    "viz_params_dict": slice_viz,
                    "search_query": cover_search_query
                    if (is_cover and cover_search_query)
                    else search_query,
                }
            )

    if not tasks:
        return

    total_mpc = sum(1 for t in tasks if t["use_mpc"])
    total_local = len(tasks) - total_mpc
    logger.info(
        "Registering %d mosaic slices in parallel (%d MPC, %d local)",
        len(tasks),
        total_mpc,
        total_local,
    )

    # Collect user-facing error messages (no internal details)
    registration_errors: list[dict] = []

    def _register_one_with_retry(task: dict) -> tuple[int, dict | str | None, bool]:
        """Returns (slice_id, result_or_search_id, is_mpc_tile)."""
        db_slice = task["db_slice"]
        stac = task["stac"]
        use_mpc = task["use_mpc"]
        dt_range = f"{db_slice.start_date}T00:00:00Z/{db_slice.end_date}T23:59:59Z"
        custom_query = task.get("search_query")
        last_error = ""

        for attempt in range(MAX_RETRIES + 1):
            try:
                if use_mpc:
                    search_id = _register_mpc_slice(stac, db_slice, bbox, custom_query)
                    return db_slice.id, search_id, True
                else:
                    result = register_mosaic_sync(
                        catalog_url=stac.catalog_url,
                        collection_id=stac.stac_collection_id,
                        bbox=bbox,
                        datetime_range=dt_range,
                        search_query=custom_query,
                    )
                    return db_slice.id, result, False
            except Exception as e:
                last_error = _sanitize_stac_error(e)
                if attempt < MAX_RETRIES:
                    time.sleep(1 * (attempt + 1))
                    continue
                logger.warning(
                    "Mosaic registration failed after %d retries for %s slice %s (%s)",
                    MAX_RETRIES,
                    task["collection_name"],
                    db_slice.name,
                    dt_range,
                    exc_info=True,
                )
                registration_errors.append(
                    {
                        "collection": task["collection_name"],
                        "slice": db_slice.name,
                        "datetime": dt_range,
                        "error": last_error,
                    }
                )
                return db_slice.id, None, use_mpc

    # Execute all in parallel
    results: dict[int, tuple] = {}  # slice_id -> (result, is_mpc_tile)
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        futures = {pool.submit(_register_one_with_retry, t): t for t in tasks}
        for future in as_completed(futures):
            slice_id, result, is_mpc_tile = future.result()
            results[slice_id] = (result, is_mpc_tile)

    succeeded = sum(1 for _, (r, _) in results.items() if r is not None)
    logger.info(
        "Mosaic registration complete: %d/%d slices succeeded",
        succeeded,
        len(tasks),
    )

    # Build lookups
    task_by_slice: dict[int, dict] = {t["db_slice"].id: t for t in tasks}

    # Persist tile URLs and mosaic registrations
    for slice_id, (result, is_mpc_tile) in results.items():
        task = task_by_slice[slice_id]
        viz_names = task["viz_names"]
        viz_params_dict = task["viz_params_dict"]
        stac = task["stac"]

        if result is None:
            # Registration failed - no tile URLs to persist
            continue

        if is_mpc_tile:
            search_id = result
            # Build MPC tile URL with viz params baked in
            base_url = (
                MPC_TILES_BASE.replace("{searchId}", search_id)
                + f"?collection={stac.stac_collection_id}&pixel_selection=first"
            )
            viz_qs = build_viz_query_string(viz_params_dict)
            tile_url = f"{base_url}&{viz_qs}" if viz_qs else base_url

            for viz_name in viz_names:
                db.add(
                    SliceTileUrl(
                        slice_id=slice_id,
                        visualization_name=viz_name,
                        tile_url=tile_url,
                        tile_provider="mpc",
                    )
                )
        else:
            mosaic_id = result["mosaic_id"]
            item_refs = result["item_refs"]

            # Persist MosaicRegistration
            db_slice = task["db_slice"]
            datetime_range = f"{db_slice.start_date}T00:00:00Z/{db_slice.end_date}T23:59:59Z"
            existing_reg = db.query(MosaicRegistration).filter_by(mosaic_id=mosaic_id).first()
            if existing_reg:
                # Update existing registration
                existing_reg.item_count = len(item_refs)
                existing_reg.assets_info = result.get("assets")
                existing_reg.status = "ready" if item_refs else "empty"
                existing_reg.registered_at = dt.utcnow()
                existing_reg.error_message = None
                # Replace items
                db.query(MosaicItem).filter_by(mosaic_id=mosaic_id).delete()
            else:
                db.add(
                    MosaicRegistration(
                        mosaic_id=mosaic_id,
                        catalog_url=stac.catalog_url,
                        stac_collection_id=stac.stac_collection_id,
                        bbox=bbox,
                        datetime_range=datetime_range,
                        max_cloud_cover=stac.max_cloud_cover,
                        item_count=len(item_refs),
                        assets_info=result.get("assets"),
                        status="ready" if item_refs else "empty",
                        registered_at=dt.utcnow(),
                    )
                )
            db.flush()

            # Persist MosaicItems
            for ref in item_refs:
                db.add(
                    MosaicItem(
                        mosaic_id=mosaic_id,
                        item_id=ref["id"],
                        href=ref["href"],
                        bbox_west=ref["bbox"][0],
                        bbox_south=ref["bbox"][1],
                        bbox_east=ref["bbox"][2],
                        bbox_north=ref["bbox"][3],
                        datetime=ref.get("datetime", ""),
                        cloud_cover=ref.get("cloud_cover"),
                        geom=_bbox_to_wkt(
                            ref["bbox"][0], ref["bbox"][1], ref["bbox"][2], ref["bbox"][3]
                        ),
                    )
                )

            # Build tile URL with viz params baked in
            base_url = f"/api/stac/mosaic/{mosaic_id}/tiles/{{z}}/{{x}}/{{y}}.png"
            viz_qs = build_viz_query_string(viz_params_dict)
            tile_url = f"{base_url}?{viz_qs}" if viz_qs else base_url

            for viz_name in viz_names:
                db.add(
                    SliceTileUrl(
                        slice_id=slice_id,
                        visualization_name=viz_name,
                        tile_url=tile_url,
                        tile_provider="self_hosted",
                        mosaic_id=mosaic_id,
                    )
                )

    return registration_errors


def _register_mpc_slice(stac, db_slice, bbox: list[float], search_query: dict | None = None) -> str:
    """Register a single slice mosaic via MPC. Returns searchid.

    The search_query is the CQL2-JSON body built by the frontend.
    Bbox and datetime ({sliceDatetime} placeholder) are injected.
    """
    import copy

    import httpx

    if not search_query:
        raise ValueError(
            "search_query is required for MPC registration. "
            "The frontend must provide the full CQL2-JSON query."
        )

    search_body = copy.deepcopy(search_query)
    search_body["bbox"] = bbox
    _inject_datetime_into_query(
        search_body,
        f"{db_slice.start_date}T00:00:00Z",
        f"{db_slice.end_date}T23:59:59Z",
    )
    if "filterLang" not in search_body:
        search_body["filterLang"] = "cql2-json"

    resp = httpx.post(MPC_REGISTER_URL, json=search_body, timeout=30)
    resp.raise_for_status()
    return resp.json()["searchid"]


def _inject_datetime_into_query(body: dict, start: str, end: str) -> None:
    """Replace datetime placeholders in a CQL2-JSON filter body,
    or inject a datetime filter if none exists."""
    import json

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


# ============================================================================
# STAC Re-registration (bbox change)
# ============================================================================


def re_register_stac_collections(db: Session, campaign_id: int, bbox: list[float]) -> int:
    """
    Re-register STAC mosaics for every STAC-based collection in a campaign
    using a new bounding box.  Returns the number of collections updated.

    Requires that ``viz_url_templates`` was previously persisted on each
    ``CollectionStacConfig``.  Collections without stored templates are skipped.
    """
    sources = db.query(ImagerySource).filter(ImagerySource.campaign_id == campaign_id).all()

    updated = 0
    for source in sources:
        for collection in source.collections:
            stac = collection.stac_config
            if not stac or not stac.viz_url_templates:
                continue

            slices = (
                db.query(ImagerySlice)
                .filter(ImagerySlice.collection_id == collection.id)
                .order_by(ImagerySlice.display_order)
                .all()
            )
            if not slices:
                continue

            slice_descriptors = [
                {"index": i, "start_date": s.start_date, "end_date": s.end_date}
                for i, s in enumerate(slices)
            ]

            try:
                results = register_collection_slices(
                    registration_url=stac.registration_url,
                    search_body=stac.search_body,
                    bbox=bbox,
                    slices=slice_descriptors,
                    viz_url_templates=stac.viz_url_templates,
                )

                for result in results:
                    idx = result["slice_index"]
                    if idx < len(slices):
                        db.query(SliceTileUrl).filter(
                            SliceTileUrl.slice_id == slices[idx].id
                        ).delete()
                        for tile in result["tile_urls"]:
                            db.add(
                                SliceTileUrl(
                                    slice_id=slices[idx].id,
                                    visualization_name=tile["viz_name"],
                                    tile_url=tile["url"],
                                )
                            )
                updated += 1
            except Exception:
                logger.warning(
                    "STAC re-registration failed for collection %s (id=%s)",
                    collection.name,
                    collection.id,
                    exc_info=True,
                )

    return updated


def update_collection_viz_params(
    db: Session,
    collection_id: int,
    viz_by_name: dict[str, dict] | None = None,
    cover_viz_by_name: dict[str, dict] | None = None,
) -> None:
    """Rebuild tile URLs with new per-visualization params (no STAC re-search needed).

    viz_by_name: { "True Color": {assets: [...], rescale: ...}, "NDVI": {...} }
    cover_viz_by_name: optional overrides for cover slice (same shape)

    Updates the stac_config (stores first viz's params for backward compat)
    and reconstructs the query-string portion of all SliceTileUrl rows.
    """
    from urllib.parse import parse_qs, urlencode, urlparse, urlunparse

    if not viz_by_name:
        return

    collection = db.query(ImageryCollection).filter_by(id=collection_id).first()
    if not collection or not collection.stac_config:
        return

    stac = collection.stac_config
    # Store first viz params on stac_config for backward compat / display
    first_params = next(iter(viz_by_name.values()), None)
    stac.viz_params = first_params
    first_cover = (
        next(iter((cover_viz_by_name or {}).values()), None) if cover_viz_by_name else None
    )
    stac.cover_viz_params = first_cover

    slices = (
        db.query(ImagerySlice)
        .filter(ImagerySlice.collection_id == collection.id)
        .order_by(ImagerySlice.display_order)
        .all()
    )

    for sl_idx, sl in enumerate(slices):
        is_cover = sl_idx == collection.cover_slice_index

        for tu in sl.tile_urls:
            # Pick params for this specific visualization
            if is_cover and cover_viz_by_name and tu.visualization_name in cover_viz_by_name:
                params = cover_viz_by_name[tu.visualization_name]
            elif tu.visualization_name in viz_by_name:
                params = viz_by_name[tu.visualization_name]
            else:
                params = first_params

            viz_qs = build_viz_query_string(params)

            if tu.tile_provider == "self_hosted" and tu.mosaic_id:
                base = f"/api/stac/mosaic/{tu.mosaic_id}/tiles/{{z}}/{{x}}/{{y}}.png"
                tu.tile_url = f"{base}?{viz_qs}" if viz_qs else base
            elif tu.tile_provider == "mpc":
                parsed = urlparse(tu.tile_url)
                existing = parse_qs(parsed.query, keep_blank_values=True)
                kept = {
                    k: v[0] for k, v in existing.items() if k in ("collection", "pixel_selection")
                }
                new_qs = urlencode(list(kept.items()))
                if viz_qs:
                    new_qs = f"{new_qs}&{viz_qs}" if new_qs else viz_qs
                tu.tile_url = urlunparse(parsed._replace(query=new_qs))

    db.flush()


def update_collection_tile_urls(
    db: Session,
    collection_id: int,
    tile_urls_by_viz: dict[str, str],
) -> None:
    """Update raw tile URLs for XYZ/manual collections.

    tile_urls_by_viz: { "True Color": "https://...", "NDVI": "https://..." }
    Updates all slices to use the new URL for each visualization.
    """
    collection = db.query(ImageryCollection).filter_by(id=collection_id).first()
    if not collection:
        return

    slices = db.query(ImagerySlice).filter(ImagerySlice.collection_id == collection.id).all()

    for sl in slices:
        for tu in sl.tile_urls:
            if tu.visualization_name in tile_urls_by_viz:
                tu.tile_url = tile_urls_by_viz[tu.visualization_name]

    db.flush()


def refresh_collection_imagery(
    db: Session,
    collection_id: int,
    bbox: list[float],
) -> dict:
    """Re-search STAC catalog with stored params, update mosaic items.

    Returns dict with status and registered_at.
    """
    from datetime import datetime as dt

    collection = db.query(ImageryCollection).filter_by(id=collection_id).first()
    if not collection or not collection.stac_config:
        raise HTTPException(status_code=404, detail="Collection not found or no STAC config")

    stac = collection.stac_config
    if not stac.catalog_url or not stac.stac_collection_id:
        raise HTTPException(status_code=400, detail="Collection is not a STAC browser collection")

    slices = (
        db.query(ImagerySlice)
        .filter(ImagerySlice.collection_id == collection.id)
        .order_by(ImagerySlice.display_order)
        .all()
    )

    refreshed_count = 0
    for sl_idx, sl in enumerate(slices):
        is_cover = sl_idx == collection.cover_slice_index
        custom_query = (
            stac.cover_search_query if (is_cover and stac.cover_search_query) else stac.search_query
        )
        viz_params = (
            stac.cover_viz_params if (is_cover and stac.cover_viz_params) else stac.viz_params
        )

        # Only refresh self_hosted mosaics (MPC manages its own)
        for tu in sl.tile_urls:
            if tu.tile_provider != "self_hosted" or not tu.mosaic_id:
                continue

            dt_range = f"{sl.start_date}T00:00:00Z/{sl.end_date}T23:59:59Z"
            try:
                result = register_mosaic_sync(
                    catalog_url=stac.catalog_url,
                    collection_id=stac.stac_collection_id,
                    bbox=bbox,
                    datetime_range=dt_range,
                    search_query=custom_query,
                )
                mosaic_id = result["mosaic_id"]
                item_refs = result["item_refs"]

                # Update MosaicRegistration
                reg = db.query(MosaicRegistration).filter_by(mosaic_id=mosaic_id).first()
                if reg:
                    reg.item_count = len(item_refs)
                    reg.assets_info = result.get("assets")
                    reg.status = "ready" if item_refs else "empty"
                    reg.registered_at = dt.utcnow()
                    reg.error_message = None
                    db.query(MosaicItem).filter_by(mosaic_id=mosaic_id).delete()
                else:
                    db.add(
                        MosaicRegistration(
                            mosaic_id=mosaic_id,
                            catalog_url=stac.catalog_url,
                            stac_collection_id=stac.stac_collection_id,
                            bbox=bbox,
                            datetime_range=dt_range,
                            max_cloud_cover=stac.max_cloud_cover,
                            item_count=len(item_refs),
                            assets_info=result.get("assets"),
                            status="ready" if item_refs else "empty",
                            registered_at=dt.utcnow(),
                        )
                    )
                db.flush()

                for ref in item_refs:
                    db.add(
                        MosaicItem(
                            mosaic_id=mosaic_id,
                            item_id=ref["id"],
                            href=ref["href"],
                            bbox_west=ref["bbox"][0],
                            bbox_south=ref["bbox"][1],
                            bbox_east=ref["bbox"][2],
                            bbox_north=ref["bbox"][3],
                            datetime=ref.get("datetime", ""),
                            cloud_cover=ref.get("cloud_cover"),
                            geom=_bbox_to_wkt(
                                ref["bbox"][0], ref["bbox"][1], ref["bbox"][2], ref["bbox"][3]
                            ),
                        )
                    )

                # Rebuild tile URL with viz params
                base_url = f"/api/stac/mosaic/{mosaic_id}/tiles/{{z}}/{{x}}/{{y}}.png"
                viz_qs = build_viz_query_string(viz_params)
                tu.tile_url = f"{base_url}?{viz_qs}" if viz_qs else base_url
                tu.mosaic_id = mosaic_id

                refreshed_count += 1
            except Exception:
                logger.warning(
                    "Refresh failed for slice %s (mosaic %s)", sl.name, tu.mosaic_id, exc_info=True
                )

    db.flush()
    return {
        "status": "refreshed",
        "slices_updated": refreshed_count,
        "registered_at": dt.utcnow().isoformat(),
    }


def _create_basemaps(
    db: Session,
    campaign_id: int,
    basemaps: list[BasemapCreate],
) -> list[Basemap]:
    created = []
    for bm in basemaps:
        obj = Basemap(campaign_id=campaign_id, name=bm.name, url=bm.url)
        db.add(obj)
        created.append(obj)
    return created


def _create_views(
    db: Session,
    campaign_id: int,
    views: list[ImageryViewCreate],
    source_creates: list[ImagerySourceCreate],
    source_id_map: dict[str, int],
    collection_id_map: dict[str, int],
) -> list[ImageryView]:
    """
    Create views and map frontend temp ids to DB ids in collection_refs.

    The frontend sends collection_refs with source_id / collection_id as frontend temp strings.
    We map them to DB-assigned integer ids.
    """
    created = []
    for view_idx, view_create in enumerate(views):
        mapped_refs = []
        for ref in view_create.collection_refs:
            # Frontend sends source_id and collection_id as temp identifiers.
            # We need to map them to the DB-assigned integer ids.
            fe_source_id = ref.source_id
            fe_collection_id = ref.collection_id

            # Look up db ids
            db_source_id = source_id_map.get(fe_source_id)
            if db_source_id is None:
                # Try to find by iterating source_creates and matching
                for s_idx, s in enumerate(source_creates):
                    if s.name == fe_source_id or str(s_idx) == fe_source_id:
                        db_source_id = source_id_map.get(str(s_idx))
                        break

            # For collection, find by composite key
            db_collection_id = None
            for key, val in collection_id_map.items():
                s_idx_str, c_idx_str = key.split(":")
                if source_id_map.get(s_idx_str) == db_source_id:
                    # Check if the collection index matches
                    s_idx = int(s_idx_str)
                    c_idx = int(c_idx_str)
                    if s_idx < len(source_creates):
                        src_cols = source_creates[s_idx].collections
                        if c_idx < len(src_cols):
                            col = src_cols[c_idx]
                            if col.name == fe_collection_id or str(c_idx) == fe_collection_id:
                                db_collection_id = val
                                break

            if db_source_id and db_collection_id:
                mapped_refs.append(
                    {
                        "collection_id": db_collection_id,
                        "source_id": db_source_id,
                        "show_as_window": ref.show_as_window,
                    }
                )

        view = ImageryView(
            campaign_id=campaign_id,
            name=view_create.name,
            display_order=view_idx,
            collection_refs=mapped_refs,
        )
        db.add(view)
        db.flush()

        # Build default view layout data for window collections
        # Windows are placed in rows below the main canvas (which ends at y=25).
        # With a 60-col grid and w=10, we fit 6 windows per row.
        window_refs = [r for r in mapped_refs if r.get("show_as_window")]
        COLS_PER_ROW = 6
        WINDOW_W = 10
        WINDOW_H = 7
        START_Y = DEFAULT_CAMPAIGN_MAIN_CANVAS_LAYOUT[0]["h"]  # directly below the main canvas
        view_layout_data = []
        for w_idx, ref in enumerate(window_refs):
            row = w_idx // COLS_PER_ROW
            col = w_idx % COLS_PER_ROW
            view_layout_data.append(
                {
                    "i": str(ref["collection_id"]),
                    "x": col * WINDOW_W,
                    "y": START_Y + row * WINDOW_H,
                    "w": WINDOW_W,
                    "h": WINDOW_H,
                }
            )

        # Create default canvas layout for this view
        canvas_layout = CanvasLayout(
            layout_data=view_layout_data,
            user_id=None,
            campaign_id=campaign_id,
            view_id=view.id,
            is_default=True,
        )
        db.add(canvas_layout)

        created.append(view)

    return created


# ============================================================================
# Canvas Layout Management
# ============================================================================


def create_new_canvas_layout(
    db: Session,
    campaign_id: int,
    layout_data: CanvasLayoutCreate,
    user_id: UUID,
    view_id: int | None = None,
    should_be_default: bool = False,
) -> dict:
    """Create or update canvas layouts for a view."""

    campaign = db.query(Campaign).filter(Campaign.id == campaign_id).first()
    if not campaign:
        raise HTTPException(status_code=404, detail=f"Campaign {campaign_id} not found")

    if view_id is not None:
        view = (
            db.query(ImageryView)
            .filter(ImageryView.id == view_id, ImageryView.campaign_id == campaign_id)
            .first()
        )
        if not view:
            raise HTTPException(
                status_code=404, detail=f"View {view_id} not found in campaign {campaign_id}"
            )

    if should_be_default:
        has_admin_access = (
            db.query(CampaignUser)
            .filter(
                CampaignUser.campaign_id == campaign_id,
                CampaignUser.user_id == user_id,
                CampaignUser.is_admin,
            )
            .first()
        )
        if not has_admin_access:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only campaign admins can modify default layouts",
            )

    result = {}

    if should_be_default:
        existing_main_layout = (
            db.query(CanvasLayout)
            .filter(
                CanvasLayout.campaign_id == campaign_id,
                CanvasLayout.view_id.is_(None),
                CanvasLayout.is_default,
                CanvasLayout.user_id.is_(None),
            )
            .first()
        )
        if not existing_main_layout:
            raise HTTPException(
                status_code=404,
                detail=f"Default main canvas layout not found for campaign {campaign_id}",
            )

        existing_main_layout.layout_data = layout_data.main_layout_data
        flag_modified(existing_main_layout, "layout_data")
        result["main_layout"] = existing_main_layout

        if layout_data.view_layout_data is not None:
            if view_id is None:
                raise HTTPException(
                    status_code=400,
                    detail="view_id is required when providing view_layout_data",
                )

            existing_view_layout = (
                db.query(CanvasLayout)
                .filter(
                    CanvasLayout.campaign_id == campaign_id,
                    CanvasLayout.view_id == view_id,
                    CanvasLayout.is_default,
                    CanvasLayout.user_id.is_(None),
                )
                .first()
            )
            if not existing_view_layout:
                raise HTTPException(
                    status_code=404,
                    detail=f"Default canvas layout not found for view {view_id}",
                )

            existing_view_layout.layout_data = layout_data.view_layout_data
            flag_modified(existing_view_layout, "layout_data")
            result["view_layout"] = existing_view_layout
    else:
        main_layout = (
            db.query(CanvasLayout)
            .filter(
                CanvasLayout.user_id == user_id,
                CanvasLayout.campaign_id == campaign_id,
                CanvasLayout.view_id.is_(None),
            )
            .first()
        )

        if main_layout:
            main_layout.layout_data = layout_data.main_layout_data
            flag_modified(main_layout, "layout_data")
        else:
            main_layout = CanvasLayout(
                user_id=user_id,
                campaign_id=campaign_id,
                view_id=None,
                layout_data=layout_data.main_layout_data,
                is_default=False,
            )
            db.add(main_layout)

        result["main_layout"] = main_layout

        if layout_data.view_layout_data is not None:
            if view_id is None:
                raise HTTPException(
                    status_code=400,
                    detail="view_id is required when providing view_layout_data",
                )

            view_layout = (
                db.query(CanvasLayout)
                .filter(
                    CanvasLayout.user_id == user_id,
                    CanvasLayout.campaign_id == campaign_id,
                    CanvasLayout.view_id == view_id,
                )
                .first()
            )

            if view_layout:
                view_layout.layout_data = layout_data.view_layout_data
                flag_modified(view_layout, "layout_data")
            else:
                view_layout = CanvasLayout(
                    user_id=user_id,
                    campaign_id=campaign_id,
                    view_id=view_id,
                    layout_data=layout_data.view_layout_data,
                    is_default=False,
                )
                db.add(view_layout)

            result["view_layout"] = view_layout

    db.commit()

    if "main_layout" in result:
        db.refresh(result["main_layout"])
    if "view_layout" in result:
        db.refresh(result["view_layout"])

    return result


# ============================================================================
# Deletion
# ============================================================================


def update_source(db: Session, source_id: int, campaign_id: int, updates: dict) -> ImagerySource:
    """Update display settings and visualizations for an imagery source."""
    source = (
        db.query(ImagerySource)
        .filter(ImagerySource.id == source_id, ImagerySource.campaign_id == campaign_id)
        .first()
    )
    if not source:
        raise HTTPException(
            status_code=404,
            detail=f"Source {source_id} not found in campaign {campaign_id}",
        )

    viz_updates = updates.pop("visualizations", None)

    for key, value in updates.items():
        if value is not None and hasattr(source, key):
            setattr(source, key, value)

    if viz_updates is not None:
        # Replace all visualizations with the new list
        db.query(VisualizationTemplate).filter(
            VisualizationTemplate.source_id == source_id
        ).delete()
        db.flush()
        for i, viz in enumerate(viz_updates):
            db.add(
                VisualizationTemplate(
                    source_id=source_id,
                    name=viz["name"],
                    display_order=i,
                )
            )

    db.commit()
    db.refresh(source)
    return source


def delete_source(db: Session, source_id: int, campaign_id: int) -> None:
    source = (
        db.query(ImagerySource)
        .filter(ImagerySource.id == source_id, ImagerySource.campaign_id == campaign_id)
        .first()
    )
    if not source:
        raise HTTPException(
            status_code=404,
            detail=f"Source {source_id} not found in campaign {campaign_id}",
        )
    db.delete(source)
    db.commit()
