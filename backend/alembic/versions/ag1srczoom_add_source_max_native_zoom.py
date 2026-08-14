"""add max_native_zoom to imagery sources

Revision ID: ag1srczoom
Revises: af2nullerrs
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "ag1srczoom"
down_revision: str | Sequence[str] | None = "af2nullerrs"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "imagery_sources",
        sa.Column("max_native_zoom", sa.SmallInteger(), nullable=True),
        schema="data",
    )


def downgrade() -> None:
    op.drop_column("imagery_sources", "max_native_zoom", schema="data")
