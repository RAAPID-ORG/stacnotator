"""One name for the tiler a collection or tile URL is served by

The column was ``tile_provider`` while the API called the same value ``tiler``
on collections and ``provider`` on a visualizer's tiles.

Revision ID: av8tiler
Revises: av7cmrun
Create Date: 2026-10-23
"""

from collections.abc import Sequence

from alembic import op

revision: str = "av8tiler"
down_revision: str | Sequence[str] | None = "av7cmrun"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    for table in ("collection_stac_configs", "slice_tile_urls"):
        op.alter_column(table, "tile_provider", new_column_name="tiler", schema="data")


def downgrade() -> None:
    for table in ("collection_stac_configs", "slice_tile_urls"):
        op.alter_column(table, "tiler", new_column_name="tile_provider", schema="data")
