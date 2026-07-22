from sqlalchemy import select
from sqlalchemy.orm import Session

from src.imagery.models import (
    CollectionVizConfig,
    ImageryCollection,
    ImagerySlice,
    SliceTileUrl,
)
from src.tilers import providers
from src.tilers.providers import build_viz_query_string


def _slice_viz_params(stac, viz_name: str, is_cover: bool) -> dict:
    """Per-visualization params for a slice, applying the cover override when present.

    Reads from the collection's CollectionVizConfig rows.
    """
    for vc in stac.collection.viz_configs if stac.collection else []:
        if vc.name == viz_name:
            if is_cover and vc.cover_render_params:
                return vc.cover_render_params
            return vc.render_params or {}
    return {}


def update_collection_viz_params(
    db: Session,
    collection_id: int,
    viz_by_name: dict[str, dict] | None = None,
    cover_viz_by_name: dict[str, dict] | None = None,
) -> None:
    """Rebuild tile URLs with new per-visualization params (no STAC re-search needed).

    viz_by_name: { "True Color": {assets: [...], rescale: ...}, "NDVI": {...} }
    cover_viz_by_name: optional overrides for cover slice (same shape)

    Updates the collection's CollectionVizConfig rows and reconstructs the
    query-string portion of all SliceTileUrl rows.
    """
    from urllib.parse import parse_qs, urlencode, urlparse, urlunparse

    if not viz_by_name:
        return

    collection = db.execute(
        select(ImageryCollection).where(ImageryCollection.id == collection_id)
    ).scalar_one_or_none()
    if not collection or not collection.stac_config:
        return

    # Keep CollectionVizConfig rows in sync with the rebaked params.
    existing_viz_configs = {
        row.name: row
        for row in db.execute(
            select(CollectionVizConfig).where(CollectionVizConfig.collection_id == collection_id)
        )
        .scalars()
        .all()
    }
    for i, (name, params) in enumerate(viz_by_name.items()):
        cover_render = (
            (cover_viz_by_name or {}).get(name) if collection.has_dedicated_cover else None
        )
        if name in existing_viz_configs:
            row = existing_viz_configs[name]
            row.display_order = i
            row.render_params = params
            row.cover_render_params = cover_render
        else:
            db.add(
                CollectionVizConfig(
                    collection_id=collection_id,
                    name=name,
                    display_order=i,
                    render_params=params,
                    cover_render_params=cover_render,
                )
            )
    # Remove rows for names no longer present.
    for name, row in existing_viz_configs.items():
        if name not in viz_by_name:
            db.delete(row)

    db.flush()

    slices = (
        db.execute(
            select(ImagerySlice)
            .where(ImagerySlice.collection_id == collection.id)
            .order_by(ImagerySlice.display_order)
        )
        .scalars()
        .all()
    )

    for sl_idx, sl in enumerate(slices):
        is_cover = collection.has_dedicated_cover and sl_idx == collection.cover_slice_index

        # A visualization added after this collection was first registered has no
        # tile URL row yet. Clone one from any sibling on the same slice (same
        # provider / mosaic) so every viz becomes switchable - the rebuild loop
        # below then bakes its own params into the cloned URL.
        existing_names = {tu.visualization_name for tu in sl.tile_urls}
        template = sl.tile_urls[0] if sl.tile_urls else None
        if template is not None:
            for name in viz_by_name:
                if name in existing_names:
                    continue
                clone = SliceTileUrl(
                    slice_id=sl.id,
                    visualization_name=name,
                    tile_url=template.tile_url,
                    tile_provider=template.tile_provider,
                    mosaic_id=template.mosaic_id,
                )
                db.add(clone)
                sl.tile_urls.append(clone)

        for tu in sl.tile_urls:
            # Pick params for this specific visualization; skip if name is unknown.
            if is_cover and cover_viz_by_name and tu.visualization_name in cover_viz_by_name:
                params = cover_viz_by_name[tu.visualization_name]
            elif tu.visualization_name in viz_by_name:
                params = viz_by_name[tu.visualization_name]
            else:
                continue

            if tu.tile_provider == "mpc":
                viz_qs = build_viz_query_string(params, for_mpc=True)
                parsed = urlparse(tu.tile_url)
                existing = parse_qs(parsed.query, keep_blank_values=True)
                kept = {
                    k: v[0] for k, v in existing.items() if k in ("collection", "pixel_selection")
                }
                new_qs = urlencode(list(kept.items()))
                if viz_qs:
                    new_qs = f"{new_qs}&{viz_qs}" if new_qs else viz_qs
                tu.tile_url = urlunparse(parsed._replace(query=new_qs))
            elif tu.tile_provider and tu.mosaic_id:
                # Hosted tiler: rebuild the absolute URL with the new viz params (no re-search).
                tiler = providers.resolve_tiler(tu.tile_provider)
                tu.tile_url = providers.build_tile_url("hosted", tu.mosaic_id, params, tiler=tiler)

    db.flush()
