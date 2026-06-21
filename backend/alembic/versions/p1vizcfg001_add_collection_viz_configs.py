"""add collection_viz_configs table

First-class rows for per-collection, per-visualization render params.
Replaces the JSONB blobs on collection_stac_configs (collapse happens in a
later increment). This increment is purely additive.

Revision ID: p1vizcfg001
Revises: n2b3c4annck
Create Date: 2026-06-20 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "p1vizcfg001"
down_revision: str | Sequence[str] | None = "n2b3c4annck"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
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
            "collection_id",
            "name",
            name="uq_collection_viz_configs_collection_name",
        ),
        schema="data",
    )


def downgrade() -> None:
    op.drop_table("collection_viz_configs", schema="data")
