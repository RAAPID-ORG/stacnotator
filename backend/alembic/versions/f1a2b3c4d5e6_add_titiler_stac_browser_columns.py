"""Add TiTiler/STAC browser columns to collection_stac_configs and slice_tile_urls

Adds catalog_url, stac_collection_id, tile_provider, viz_params to
collection_stac_configs for STAC catalog browser support.
Adds tile_provider to slice_tile_urls for dynamic tile URL construction.

All new columns are nullable.

Revision ID: f1a2b3c4d5e6
Revises: d5e6f7a8b9c0
Create Date: 2026-04-01 12:00:00.000000

"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

# revision identifiers, used by Alembic.
revision: str = "f1a2b3c4d5e6"
down_revision: str | None = "d5e6f7a8b9c0"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # collection_stac_configs: add STAC browser / TiTiler fields
    op.add_column(
        "collection_stac_configs",
        sa.Column("catalog_url", sa.Text(), nullable=True),
        schema="data",
    )
    op.add_column(
        "collection_stac_configs",
        sa.Column("stac_collection_id", sa.String(), nullable=True),
        schema="data",
    )
    op.add_column(
        "collection_stac_configs",
        sa.Column("tile_provider", sa.String(20), nullable=True),
        schema="data",
    )
    op.add_column(
        "collection_stac_configs",
        sa.Column("viz_params", JSONB(), nullable=True),
        schema="data",
    )

    # slice_tile_urls: add tile_provider for dynamic URL construction
    op.add_column(
        "slice_tile_urls",
        sa.Column("tile_provider", sa.String(20), nullable=True),
        schema="data",
    )


def downgrade() -> None:
    op.drop_column("slice_tile_urls", "tile_provider", schema="data")
    op.drop_column("collection_stac_configs", "viz_params", schema="data")
    op.drop_column("collection_stac_configs", "tile_provider", schema="data")
    op.drop_column("collection_stac_configs", "stac_collection_id", schema="data")
    op.drop_column("collection_stac_configs", "catalog_url", schema="data")
