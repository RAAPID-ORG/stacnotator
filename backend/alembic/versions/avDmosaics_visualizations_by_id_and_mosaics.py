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

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

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
    op.execute(
        """
        INSERT INTO data.slice_mosaics (slice_id, provider, mosaic_id)
        SELECT DISTINCT ON (u.slice_id, u.tiler) u.slice_id, u.tiler, u.mosaic_id
        FROM data.slice_tile_urls u
        JOIN data.imagery_slices s ON s.id = u.slice_id
        JOIN data.imagery_collections c ON c.id = s.collection_id
        WHERE c.catalog_url IS NOT NULL AND u.tiler IS NOT NULL AND u.mosaic_id IS NOT NULL
        ORDER BY u.slice_id, u.tiler, u.id
        """
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
