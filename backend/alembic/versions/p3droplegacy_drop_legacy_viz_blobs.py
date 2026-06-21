"""drop legacy viz_params/cover_viz_params/visualizations blobs from collection_stac_configs

These three JSONB columns are made redundant by collection_viz_configs (Phase 8 inc 1-6).
Dual-write was in place since inc 2; the read path was switched to collection_viz_configs
in inc 5. This migration removes the now-dead storage columns.

IMPORTANT: downgrade does NOT restore data — this is a one-way migration.
Before applying to a populated DB, the inc 1-4 backfill SQL must have been
run first (see docs/superpowers/plans/2026-06-20-phase8-vizconfig-collapse-plan.md §6).

Revision ID: p3droplegacy
Revises: p2tileurlfk
Create Date: 2026-06-20 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "p3droplegacy"
down_revision: str | Sequence[str] | None = "p2tileurlfk"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_column("collection_stac_configs", "viz_params", schema="data")
    op.drop_column("collection_stac_configs", "cover_viz_params", schema="data")
    op.drop_column("collection_stac_configs", "visualizations", schema="data")


def downgrade() -> None:
    # NOTE: downgrade re-adds the columns as nullable JSONB but does NOT restore data.
    # Data was only available in these columns before the Phase 8 inc 7 migration;
    # once dropped, recovery requires restoring from a pre-migration backup.
    op.add_column(
        "collection_stac_configs",
        sa.Column("visualizations", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        schema="data",
    )
    op.add_column(
        "collection_stac_configs",
        sa.Column("cover_viz_params", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        schema="data",
    )
    op.add_column(
        "collection_stac_configs",
        sa.Column("viz_params", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        schema="data",
    )
