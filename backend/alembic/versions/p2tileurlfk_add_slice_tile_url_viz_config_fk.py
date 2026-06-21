"""add visualization_id FK to slice_tile_urls

Additive column: nullable FK from slice_tile_urls → collection_viz_configs.
Dual-written on every STAC-backed SliceTileUrl creation (Phase 8 inc3).
visualization_name is kept (dual-write, not yet dropped).

Revision ID: p2tileurlfk
Revises: p1vizcfg001
Create Date: 2026-06-20 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "p2tileurlfk"
down_revision: str | Sequence[str] | None = "p1vizcfg001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "slice_tile_urls",
        sa.Column("visualization_id", sa.Integer(), nullable=True),
        schema="data",
    )
    op.create_foreign_key(
        "fk_slice_tile_urls_visualization_id",
        "slice_tile_urls",
        "collection_viz_configs",
        ["visualization_id"],
        ["id"],
        source_schema="data",
        referent_schema="data",
        ondelete="CASCADE",
    )


def downgrade() -> None:
    op.drop_constraint(
        "fk_slice_tile_urls_visualization_id",
        "slice_tile_urls",
        schema="data",
        type_="foreignkey",
    )
    op.drop_column("slice_tile_urls", "visualization_id", schema="data")
