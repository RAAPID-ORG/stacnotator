"""add viz_params + band stats to custom_maps

Revision ID: s1a2b3c4d5e6
Revises: r1a2b3c4d5e6
Create Date: 2026-05-28
"""

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

from alembic import op

revision = "s1a2b3c4d5e6"
down_revision = "r1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "custom_maps",
        sa.Column("viz_params", JSONB, nullable=True),
        schema="data",
    )
    op.add_column(
        "custom_maps",
        sa.Column("band_count", sa.SmallInteger(), nullable=True),
        schema="data",
    )
    op.add_column(
        "custom_maps",
        sa.Column("min_value", sa.Float(), nullable=True),
        schema="data",
    )
    op.add_column(
        "custom_maps",
        sa.Column("max_value", sa.Float(), nullable=True),
        schema="data",
    )


def downgrade() -> None:
    op.drop_column("custom_maps", "max_value", schema="data")
    op.drop_column("custom_maps", "min_value", schema="data")
    op.drop_column("custom_maps", "band_count", schema="data")
    op.drop_column("custom_maps", "viz_params", schema="data")
