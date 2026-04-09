"""Add cover_viz_params and max_cloud_cover to collection_stac_configs

Adds cover_viz_params JSONB column for cover slice visualization
overrides (e.g. different compositing method for the cover) and
max_cloud_cover float column for STAC search filtering.

Revision ID: g2a3b4c5d6e7
Revises: f1a2b3c4d5e6
Create Date: 2026-04-01 14:00:00.000000

"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

# revision identifiers, used by Alembic.
revision: str = "g2a3b4c5d6e7"
down_revision: str | None = "f1a2b3c4d5e6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "collection_stac_configs",
        sa.Column("cover_viz_params", JSONB(), nullable=True),
        schema="data",
    )
    op.add_column(
        "collection_stac_configs",
        sa.Column("max_cloud_cover", sa.Float(), nullable=True),
        schema="data",
    )


def downgrade() -> None:
    op.drop_column("collection_stac_configs", "max_cloud_cover", schema="data")
    op.drop_column("collection_stac_configs", "cover_viz_params", schema="data")
