"""drop visualization_id FK from slice_tile_urls

Removes the write-only visualization_id column and its FK constraint from
data.slice_tile_urls. visualization_name is the single canonical viz key.
Safe to apply with no backfill — the column was never read anywhere.

Revision ID: p4dropvizfk
Revises: p3droplegacy
Create Date: 2026-06-20 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "p4dropvizfk"
down_revision: str | Sequence[str] | None = "p3droplegacy"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_constraint(
        "fk_slice_tile_urls_visualization_id",
        "slice_tile_urls",
        schema="data",
        type_="foreignkey",
    )
    op.drop_column("slice_tile_urls", "visualization_id", schema="data")


def downgrade() -> None:
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
