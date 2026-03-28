"""add sample_extent_meters to settings

Revision ID: c4d5e6f7a8b9
Revises: b3c4d5e6f7a8
Create Date: 2026-03-20 10:00:00.000000
"""

from alembic import op
import sqlalchemy as sa

revision = "c4d5e6f7a8b9"
down_revision = "b3c4d5e6f7a8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "settings",
        sa.Column("sample_extent_meters", sa.Float(), nullable=True),
        schema="data",
    )


def downgrade() -> None:
    op.drop_column("settings", "sample_extent_meters", schema="data")
