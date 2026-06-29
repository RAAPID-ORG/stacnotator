"""add custom_maps table

Revision ID: t1custommaps
Revises: q5apikeyenc
Create Date: 2026-06-29 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "t1custommaps"
down_revision: str | Sequence[str] | None = "q5apikeyenc"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "custom_maps",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("campaign_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("cog_url", sa.Text(), nullable=False),
        sa.Column("render_config", postgresql.JSONB(), nullable=False),
        sa.Column("max_native_zoom", sa.SmallInteger(), nullable=True),
        sa.Column("mosaic_id", sa.String(length=64), nullable=True),
        sa.Column("tile_url", sa.Text(), nullable=True),
        sa.Column("status", sa.String(length=16), server_default="registering", nullable=False),
        sa.Column("status_error", postgresql.JSONB(), nullable=True),
        sa.Column("display_order", sa.SmallInteger(), server_default="0", nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["campaign_id"], ["data.campaigns.id"], ondelete="CASCADE"
        ),
        schema="data",
    )


def downgrade() -> None:
    op.drop_table("custom_maps", schema="data")
