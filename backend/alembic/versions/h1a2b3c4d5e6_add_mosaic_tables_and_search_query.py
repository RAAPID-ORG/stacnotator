"""Add mosaic_registrations, mosaic_items tables and search_query fields

Creates persistent storage for STAC mosaic item references (replacing
the volatile in-memory _mosaic_store), adds mosaic_id FK to slice_tile_urls,
and adds search_query / cover_search_query to collection_stac_configs for
custom CQL2-JSON query support.

Revision ID: h1a2b3c4d5e6
Revises: g2a3b4c5d6e7
Create Date: 2026-04-02 10:00:00.000000

"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

# revision identifiers, used by Alembic.
revision: str = "h1a2b3c4d5e6"
down_revision: str | None = "g2a3b4c5d6e7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # -- New tables --
    op.create_table(
        "mosaic_registrations",
        sa.Column("mosaic_id", sa.String(64), primary_key=True),
        sa.Column("catalog_url", sa.Text(), nullable=False),
        sa.Column("stac_collection_id", sa.String(), nullable=False),
        sa.Column("bbox", JSONB(), nullable=False),
        sa.Column("datetime_range", sa.String(), nullable=False),
        sa.Column("max_cloud_cover", sa.Float(), nullable=True),
        sa.Column("item_count", sa.Integer(), server_default="0", nullable=False),
        sa.Column("assets_info", JSONB(), nullable=True),
        sa.Column("status", sa.String(20), server_default="pending", nullable=False),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("registered_at", sa.DateTime(), server_default=sa.func.now()),
        schema="data",
    )

    op.create_table(
        "mosaic_items",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "mosaic_id",
            sa.String(64),
            sa.ForeignKey("data.mosaic_registrations.mosaic_id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("item_id", sa.String(), nullable=False),
        sa.Column("href", sa.Text(), nullable=False),
        sa.Column("bbox_west", sa.Float(), nullable=False),
        sa.Column("bbox_south", sa.Float(), nullable=False),
        sa.Column("bbox_east", sa.Float(), nullable=False),
        sa.Column("bbox_north", sa.Float(), nullable=False),
        sa.Column("datetime", sa.String(), nullable=False),
        schema="data",
    )
    op.create_index(
        "ix_mosaic_items_mosaic_id",
        "mosaic_items",
        ["mosaic_id"],
        schema="data",
    )

    # -- Add mosaic_id FK to slice_tile_urls --
    op.add_column(
        "slice_tile_urls",
        sa.Column("mosaic_id", sa.String(64), nullable=True),
        schema="data",
    )
    op.create_foreign_key(
        "fk_slice_tile_urls_mosaic_id",
        "slice_tile_urls",
        "mosaic_registrations",
        ["mosaic_id"],
        ["mosaic_id"],
        source_schema="data",
        referent_schema="data",
        ondelete="SET NULL",
    )

    # -- Add search_query fields to collection_stac_configs --
    op.add_column(
        "collection_stac_configs",
        sa.Column("search_query", JSONB(), nullable=True),
        schema="data",
    )
    op.add_column(
        "collection_stac_configs",
        sa.Column("cover_search_query", JSONB(), nullable=True),
        schema="data",
    )


def downgrade() -> None:
    op.drop_column("collection_stac_configs", "cover_search_query", schema="data")
    op.drop_column("collection_stac_configs", "search_query", schema="data")
    op.drop_constraint("fk_slice_tile_urls_mosaic_id", "slice_tile_urls", schema="data")
    op.drop_column("slice_tile_urls", "mosaic_id", schema="data")
    op.drop_index("ix_mosaic_items_mosaic_id", "mosaic_items", schema="data")
    op.drop_table("mosaic_items", schema="data")
    op.drop_table("mosaic_registrations", schema="data")
