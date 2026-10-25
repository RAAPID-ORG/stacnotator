"""Visualizations by id, the search on its collection, mosaics instead of baked URLs

A source's visualization templates become plain visualizations, keeping their ids,
and everything that named one refers to it by id instead. The
STAC search moves onto the collection it belongs to (it was a 1:1 table), and a
slice stores the mosaic each provider registered rather than a finished tile URL
per visualization: the URL is derived from the mosaic and the visualization's
parameters when read, so a parameter edit no longer needs registering again. A
manual slice keeps its URL as a template per visualization.

Downgrade restores the old tables, but not the finished URLs of STAC slices:
those slices register again on the next save.

Revision ID: avDmosaics
Revises: avCemberr
Create Date: 2026-10-23
"""

import json
import logging
from collections.abc import Sequence
from urllib.parse import parse_qsl, urlsplit

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

from alembic import op

logger = logging.getLogger("alembic.runtime.migration")

_UNMATCHED = """
SELECT
  (SELECT count(*) FROM data.collection_viz_configs v
   JOIN data.imagery_collections c ON c.id = v.collection_id
   WHERE c.catalog_url IS NOT NULL AND NOT EXISTS (
     SELECT 1 FROM data.visualizations r WHERE r.source_id = c.source_id AND r.name = v.name)),
  (SELECT count(*) FROM data.slice_tile_urls u
   JOIN data.imagery_slices s ON s.id = u.slice_id
   JOIN data.imagery_collections c ON c.id = s.collection_id
   WHERE c.catalog_url IS NULL AND NOT EXISTS (
     SELECT 1 FROM data.visualizations r
     WHERE r.source_id = c.source_id AND r.name = u.visualization_name))
"""

# p3droplegacy gave a collection saved before per-visualization parameters the one
# set it had for every visualization of its source. The slices' finished URLs were
# still built per visualization, so the duplicates never showed until URLs started
# being derived from the parameters. Such a collection's parameters are read back
# from those URLs before they are dropped.
_FANNED = """
SELECT v.id, v.collection_id, v.name, v.render_params, v.cover_render_params,
       c.has_dedicated_cover, c.cover_slice_index
FROM data.collection_viz_configs v
JOIN data.imagery_collections c ON c.id = v.collection_id
WHERE c.catalog_url IS NOT NULL AND (
  SELECT count(*) FROM data.collection_viz_configs o
  WHERE o.collection_id = v.collection_id AND o.render_params = v.render_params) > 1
"""

_URLS = """
SELECT u.tile_url, s.id
FROM data.slice_tile_urls u
JOIN data.imagery_slices s ON s.id = u.slice_id
WHERE s.collection_id = :collection AND u.visualization_name = :name
ORDER BY s.display_order, s.id
"""

_SLICE_IDS = """
SELECT id FROM data.imagery_slices WHERE collection_id = :collection ORDER BY display_order, id
"""

# What a tile URL's query carries of the parameters, as build_viz_query_string
# wrote it; MPC's leaves out the local-only ones. ``collection`` and
# ``pixel_selection`` are the URL's own, not the visualization's.
_URL_OWN = {"collection", "pixel_selection"}
_ON_EVERY_URL = {
    "assets",
    "asset_as_band",
    "expression",
    "rescale",
    "colormap_name",
    "color_formula",
    "resampling",
    "nodata",
}
_HOSTED_ONLY = {
    "bidx",
    "compositing",
    "mask_layer",
    "mask_values",
    "nir_band",
    "red_band",
    "max_items",
}


def _number(value: str) -> int | float | str:
    for kind in (int, float):
        try:
            return kind(value)
        except ValueError:
            pass
    return value


def _params_from_url(url: str, stored: dict) -> dict:
    """The parameters a finished tile URL was drawn with. What the URL cannot carry
    (an MPC URL's local-only parameters) is kept from ``stored``."""
    pairs = parse_qsl(urlsplit(url).query, keep_blank_values=True)
    carried = _ON_EVERY_URL | (set() if url.startswith(MPC_HOST) else _HOSTED_ONLY)
    params = {k: v for k, v in stored.items() if k not in carried and k != "extra_params"}
    extra: dict[str, str] = {}
    for key, value in pairs:
        if key == "assets":
            params.setdefault("assets", []).append(value)
        elif key == "mask_values":
            params.setdefault("mask_values", []).append(_number(value))
        elif key == "rescale":
            params.setdefault("rescale", value)  # repeated once per output band
        elif key == "asset_as_band":
            params["asset_as_band"] = value == "true"
        elif key == "bidx":
            params["bidx"] = [int(b) for b in value.split(",") if b]
        elif key in ("nodata", "max_items"):
            params[key] = _number(value)
        elif key in carried:
            params[key] = value
        elif key not in _URL_OWN:
            extra[key] = value
    if extra:
        params["extra_params"] = extra
    return params


def _repair_fanned_params(bind: sa.Connection) -> int:
    repaired = 0
    for row in bind.execute(sa.text(_FANNED)).mappings().all():
        slice_ids = bind.execute(sa.text(_SLICE_IDS), {"collection": row["collection_id"]})
        slice_ids = slice_ids.scalars().all()
        index = row["cover_slice_index"]
        cover_id = (
            slice_ids[index] if row["has_dedicated_cover"] and 0 <= index < len(slice_ids) else None
        )
        urls = bind.execute(
            sa.text(_URLS), {"collection": row["collection_id"], "name": row["name"]}
        ).all()
        regular = next((u for u, sid in urls if sid != cover_id), None)
        cover = next((u for u, sid in urls if sid == cover_id), None)
        if regular is None:
            continue
        params = _params_from_url(regular, row["render_params"] or {})
        cover_params = row["cover_render_params"]
        if cover is not None and cover_params is not None:
            cover_params = _params_from_url(cover, cover_params)
        if params == row["render_params"] and cover_params == row["cover_render_params"]:
            continue
        bind.execute(
            sa.text(
                "UPDATE data.collection_viz_configs "
                "SET render_params = cast(:params AS jsonb), "
                "    cover_render_params = cast(:cover AS jsonb) WHERE id = :id"
            ),
            {
                "id": row["id"],
                "params": json.dumps(params),
                "cover": json.dumps(cover_params) if cover_params is not None else None,
            },
        )
        repaired += 1
    return repaired


# Every MPC tile URL starts here; the search id follows /mosaic/.
MPC_HOST = "https://planetarycomputer.microsoft.com/"

revision: str = "avDmosaics"
down_revision: str | Sequence[str] | None = "avCemberr"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SEARCH_COLUMNS = (
    "catalog_url",
    "stac_collection_id",
    "tiler",
    "max_cloud_cover",
    "search_query",
    "cover_search_query",
    "internal_storage",
    "storage_auth",
    "encrypted_storage_secret",
    "storage_secret_expires_at",
)


def _rename_table(old: str, new: str, unique_old: str, unique_new: str) -> None:
    op.rename_table(old, new, schema="data")
    op.execute(f"ALTER SEQUENCE data.{old}_id_seq RENAME TO {new}_id_seq")
    op.execute(f"ALTER INDEX data.{old}_pkey RENAME TO {new}_pkey")
    op.execute(f"ALTER TABLE data.{new} RENAME CONSTRAINT {unique_old} TO {unique_new}")
    op.execute(
        f"ALTER TABLE data.{new} RENAME CONSTRAINT {old}_source_id_fkey TO {new}_source_id_fkey"
    )


def _search_columns() -> list[sa.Column]:
    return [
        sa.Column("catalog_url", sa.Text(), nullable=True),
        sa.Column("stac_collection_id", sa.String(), nullable=True),
        sa.Column("tiler", sa.String(64), nullable=True),
        sa.Column("max_cloud_cover", sa.Float(), nullable=True),
        sa.Column("search_query", JSONB(), nullable=True),
        sa.Column("cover_search_query", JSONB(), nullable=True),
        sa.Column("internal_storage", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("storage_auth", sa.String(32), nullable=True),
        sa.Column("encrypted_storage_secret", sa.Text(), nullable=True),
        sa.Column("storage_secret_expires_at", sa.TIMESTAMP(timezone=True), nullable=True),
    ]


def upgrade() -> None:
    _rename_table(
        "visualization_templates",
        "visualizations",
        "uq_visualization_templates_source_name",
        "uq_visualizations_source_name",
    )

    for column in _search_columns():
        op.add_column("imagery_collections", column, schema="data")
    # A config missing its catalog or collection never registered anything; such a
    # collection is a manual one.
    assignments = ", ".join(f"{c} = s.{c}" for c in SEARCH_COLUMNS)
    op.execute(
        f"""
        UPDATE data.imagery_collections c SET {assignments}
        FROM data.collection_stac_configs s
        WHERE s.collection_id = c.id
          AND s.catalog_url IS NOT NULL AND s.stac_collection_id IS NOT NULL
        """
    )
    op.create_check_constraint(
        "imagery_collections_search_whole",
        "imagery_collections",
        "(catalog_url IS NULL) = (stac_collection_id IS NULL)",
        schema="data",
    )

    repaired = _repair_fanned_params(op.get_bind())
    if repaired:
        logger.info("avDmosaics: read %d visualizations' parameters back from their URLs", repaired)

    op.create_table(
        "collection_visualizations",
        sa.Column(
            "collection_id",
            sa.Integer(),
            sa.ForeignKey("data.imagery_collections.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "visualization_id",
            sa.Integer(),
            sa.ForeignKey("data.visualizations.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("params", JSONB(), nullable=False),
        sa.Column("cover_params", JSONB(), nullable=True),
        schema="data",
    )
    op.execute(
        """
        INSERT INTO data.collection_visualizations (collection_id, visualization_id, params, cover_params)
        SELECT v.collection_id, r.id, v.render_params,
               CASE WHEN c.has_dedicated_cover THEN v.cover_render_params END
        FROM data.collection_viz_configs v
        JOIN data.imagery_collections c ON c.id = v.collection_id
        JOIN data.visualizations r ON r.source_id = c.source_id AND r.name = v.name
        WHERE c.catalog_url IS NOT NULL
        """
    )

    op.create_table(
        "slice_mosaics",
        sa.Column(
            "slice_id",
            sa.Integer(),
            sa.ForeignKey("data.imagery_slices.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("provider", sa.String(64), primary_key=True),
        sa.Column("mosaic_id", sa.String(64), nullable=False),
        schema="data",
    )
    # Rows written while mosaic_id still referenced the local mosaic table could not
    # hold an MPC search id, so an MPC slice from then has it only in its URL.
    op.execute(
        sa.text(
            """
        INSERT INTO data.slice_mosaics (slice_id, provider, mosaic_id)
        SELECT DISTINCT ON (r.slice_id, r.provider) r.slice_id, r.provider, r.mosaic_id
        FROM (
          SELECT u.id, u.slice_id,
                 COALESCE(u.tiler, CASE WHEN u.tile_url LIKE :mpc THEN 'mpc' END) AS provider,
                 COALESCE(u.mosaic_id, CASE WHEN u.tile_url LIKE :mpc
                   THEN substring(u.tile_url FROM '/mosaic/([^/?]+)/tiles') END) AS mosaic_id
          FROM data.slice_tile_urls u
          JOIN data.imagery_slices s ON s.id = u.slice_id
          JOIN data.imagery_collections c ON c.id = s.collection_id
          WHERE c.catalog_url IS NOT NULL
        ) r
        WHERE r.provider IS NOT NULL AND r.mosaic_id IS NOT NULL
        ORDER BY r.slice_id, r.provider, r.id
        """
        ).bindparams(mpc=f"{MPC_HOST}%")
    )

    op.create_table(
        "slice_templates",
        sa.Column(
            "slice_id",
            sa.Integer(),
            sa.ForeignKey("data.imagery_slices.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "visualization_id",
            sa.Integer(),
            sa.ForeignKey("data.visualizations.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("url", sa.Text(), nullable=False),
        schema="data",
    )
    op.execute(
        """
        INSERT INTO data.slice_templates (slice_id, visualization_id, url)
        SELECT u.slice_id, r.id, u.tile_url
        FROM data.slice_tile_urls u
        JOIN data.imagery_slices s ON s.id = u.slice_id
        JOIN data.imagery_collections c ON c.id = s.collection_id
        JOIN data.visualizations r
          ON r.source_id = c.source_id AND r.name = u.visualization_name
        WHERE c.catalog_url IS NULL
        """
    )

    # Rows naming a visualization their source does not have were never drawn (the
    # old code looked them up by that name too), so they are not carried over. Say how
    # many, so a deploy log shows it.
    unmatched = op.get_bind().execute(sa.text(_UNMATCHED)).one()
    if any(unmatched):
        logger.warning(
            "avDmosaics: dropped %d STAC parameter rows and %d manual tile URLs naming no "
            "visualization of their source",
            *unmatched,
        )

    op.drop_table("slice_tile_urls", schema="data")
    op.drop_table("collection_viz_configs", schema="data")
    op.drop_table("collection_stac_configs", schema="data")


def downgrade() -> None:
    op.create_table(
        "collection_stac_configs",
        sa.Column(
            "collection_id",
            sa.Integer(),
            sa.ForeignKey("data.imagery_collections.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        *_search_columns(),
        schema="data",
    )
    columns = ", ".join(SEARCH_COLUMNS)
    op.execute(
        f"""
        INSERT INTO data.collection_stac_configs (collection_id, {columns})
        SELECT id, {columns} FROM data.imagery_collections WHERE catalog_url IS NOT NULL
        """
    )

    op.create_table(
        "collection_viz_configs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "collection_id",
            sa.Integer(),
            sa.ForeignKey("data.imagery_collections.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("display_order", sa.SmallInteger(), server_default="0", nullable=False),
        sa.Column("render_params", JSONB(), nullable=False),
        sa.Column("cover_render_params", JSONB(), nullable=True),
        sa.UniqueConstraint(
            "collection_id", "name", name="uq_collection_viz_configs_collection_name"
        ),
        schema="data",
    )
    op.execute(
        """
        INSERT INTO data.collection_viz_configs
            (collection_id, name, display_order, render_params, cover_render_params)
        SELECT cr.collection_id, r.name, r.display_order, cr.params, cr.cover_params
        FROM data.collection_visualizations cr
        JOIN data.visualizations r ON r.id = cr.visualization_id
        """
    )

    op.create_table(
        "slice_tile_urls",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "slice_id",
            sa.Integer(),
            sa.ForeignKey("data.imagery_slices.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("visualization_name", sa.String(), nullable=False),
        sa.Column("tile_url", sa.Text(), nullable=False),
        sa.Column("tiler", sa.String(64), nullable=True),
        sa.Column("mosaic_id", sa.String(64), nullable=True),
        sa.UniqueConstraint("slice_id", "visualization_name", name="uq_slice_tile_urls_slice_viz"),
        schema="data",
    )
    op.execute(
        """
        INSERT INTO data.slice_tile_urls (slice_id, visualization_name, tile_url)
        SELECT t.slice_id, r.name, t.url
        FROM data.slice_templates t
        JOIN data.visualizations r ON r.id = t.visualization_id
        """
    )

    op.drop_table("slice_templates", schema="data")
    op.drop_table("slice_mosaics", schema="data")
    op.drop_table("collection_visualizations", schema="data")
    op.drop_constraint("imagery_collections_search_whole", "imagery_collections", schema="data")
    for column in SEARCH_COLUMNS:
        op.drop_column("imagery_collections", column, schema="data")
    _rename_table(
        "visualizations",
        "visualization_templates",
        "uq_visualizations_source_name",
        "uq_visualization_templates_source_name",
    )
