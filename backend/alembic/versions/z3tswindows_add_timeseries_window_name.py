"""Add window_name to time_series for splitting timeseries into canvas windows.

Revision ID: z3tswindows
Revises: z2formfields
Create Date: 2026-07-18 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "z3tswindows"
down_revision: str | Sequence[str] | None = "z2formfields"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Nullable: existing series keep NULL and collapse into the default
    # timeseries window, preserving today's single-window behaviour.
    op.add_column(
        "time_series",
        sa.Column("window_name", sa.String(), nullable=True),
        schema="data",
    )


def downgrade() -> None:
    op.drop_column("time_series", "window_name", schema="data")
