"""Migrate legacy stac collections to stac_browser format

Converts all collection_stac_configs that use the legacy registration_url /
search_body path to the stac_browser path (catalog_url + stac_collection_id +
viz_params + search_query).

All legacy rows used the MPC mosaic register endpoint, so catalog_url is always
the MPC STAC catalog. viz_params are derived from stored viz_url_templates where
available, or from existing slice_tile_urls otherwise.

Revision ID: s1a2b3c4d5e6
Revises: r1a2b3c4d5e6
"""

import json
import logging
from urllib.parse import parse_qs, urlparse

import sqlalchemy as sa
from alembic import op

revision: str = "s1a2b3c4d5e6"
down_revision: str | None = "q1a2b3c4d5e6"
branch_labels = None
depends_on = None

logger = logging.getLogger(__name__)

MPC_CATALOG_URL = "https://planetarycomputer.microsoft.com/api/stac/v1"


def _viz_params_from_mpc_url(tile_url: str) -> dict:
    """Parse an MPC tile URL back into a viz_params dict."""
    qs = parse_qs(urlparse(tile_url).query)

    def first(key):
        vals = qs.get(key, [])
        return vals[0] if vals else None

    params = {}
    assets = qs.get("assets", [])
    if assets:
        params["assets"] = assets
    if first("asset_as_band") == "true":
        params["asset_as_band"] = True
    if first("expression"):
        params["expression"] = first("expression")
    rescale_vals = qs.get("rescale", [])
    if rescale_vals:
        params["rescale"] = rescale_vals[0]
    if first("colormap_name"):
        params["colormap_name"] = first("colormap_name")
    if first("color_formula"):
        params["color_formula"] = first("color_formula")
    if first("resampling"):
        params["resampling"] = first("resampling")
    nodata = first("nodata")
    if nodata is not None:
        try:
            params["nodata"] = float(nodata)
        except ValueError:
            params["nodata"] = nodata

    # asset_bidx (NAIP-style band index override) -> extra_params
    asset_bidx = qs.get("asset_bidx", [])
    if asset_bidx:
        params.setdefault("extra_params", {})["asset_bidx"] = asset_bidx[0]

    return params


def _search_body_to_query(search_body: str) -> dict:
    """Convert legacy search_body (with placeholders) to search_query format."""
    raw = (
        search_body
        .replace("{startDatetimePlaceholder}", "{sliceStart}")
        .replace("{endDatetimePlaceholder}", "{sliceEnd}")
    )
    body = json.loads(raw)
    body.pop("bbox", None)
    body.pop("metadata", None)
    return body


def upgrade() -> None:
    conn = op.get_bind()

    legacy_rows = conn.execute(
        sa.text(
            "SELECT collection_id, registration_url, search_body, viz_url_templates "
            "FROM data.collection_stac_configs "
            "WHERE registration_url != ''"
        )
    ).fetchall()

    logger.info("Migrating %d legacy stac collections to stac_browser format", len(legacy_rows))

    for row in legacy_rows:
        collection_id = row[0]
        search_body = row[2]
        viz_url_templates = row[3]

        # Extract stac_collection_id from search body
        try:
            body = json.loads(search_body)
            stac_collection_id = body.get("collections", [None])[0]
        except Exception:
            logger.warning("Could not parse search_body for collection %s, skipping", collection_id)
            continue

        if not stac_collection_id:
            logger.warning("No collection ID in search_body for collection %s, skipping", collection_id)
            continue

        # Build viz_params: prefer viz_url_templates, fall back to existing tile URLs
        viz_params = None
        if viz_url_templates:
            templates = json.loads(viz_url_templates) if isinstance(viz_url_templates, str) else viz_url_templates
            if templates:
                viz_params = _viz_params_from_mpc_url(templates[0]["url_template"])

        if not viz_params:
            tile_url_row = conn.execute(
                sa.text(
                    "SELECT stu.tile_url FROM data.slice_tile_urls stu "
                    "JOIN data.imagery_slices sl ON sl.id = stu.slice_id "
                    "WHERE sl.collection_id = :cid LIMIT 1"
                ),
                {"cid": collection_id},
            ).fetchone()
            if tile_url_row:
                viz_params = _viz_params_from_mpc_url(tile_url_row[0])

        # Convert search_body to search_query
        try:
            search_query = _search_body_to_query(search_body)
        except Exception:
            logger.warning("Could not convert search_body for collection %s", collection_id)
            search_query = None

        conn.execute(
            sa.text(
                "UPDATE data.collection_stac_configs SET "
                "  catalog_url = :catalog_url, "
                "  stac_collection_id = :stac_collection_id, "
                "  viz_params = :viz_params, "
                "  search_query = :search_query "
                "WHERE collection_id = :cid"
            ),
            {
                "catalog_url": MPC_CATALOG_URL,
                "stac_collection_id": stac_collection_id,
                "viz_params": json.dumps(viz_params) if viz_params else None,
                "search_query": json.dumps(search_query) if search_query else None,
                "cid": collection_id,
            },
        )

        # Mark existing slice_tile_urls as mpc so re_register_stac_collections picks them up
        conn.execute(
            sa.text(
                "UPDATE data.slice_tile_urls SET tile_provider = 'mpc' "
                "WHERE slice_id IN ("
                "  SELECT id FROM data.imagery_slices WHERE collection_id = :cid"
                ") AND tile_provider IS NULL"
            ),
            {"cid": collection_id},
        )

    logger.info("Migration complete")


def downgrade() -> None:
    pass
