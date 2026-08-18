"""add per-visualization params to collection_stac_configs

Stores the full list of named visualization params per collection so a
roundtrip-save no longer collapses every visualization onto the first one's
params. The viz_params / cover_viz_params blobs were kept at the time for
existing readers; p3droplegacy later dropped them.

Revision ID: e2f3a4b5c6d7
Revises: d1f2a3b4c5e6
Create Date: 2026-06-08 00:00:00.000000
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "e2f3a4b5c6d7"
down_revision = "d1f2a3b4c5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "collection_stac_configs",
        sa.Column("visualizations", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        schema="data",
    )


def downgrade() -> None:
    op.drop_column("collection_stac_configs", "visualizations", schema="data")
