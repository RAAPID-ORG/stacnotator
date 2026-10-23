"""Custom map registration joins the background-run protocol

A heartbeat column, so a run whose worker died can be told from one still going,
and the error kept as a list like every other run's errors column.

Revision ID: av7cmrun
Revises: av6genkind
Create Date: 2026-10-23
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "av7cmrun"
down_revision: str | Sequence[str] | None = "av6genkind"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "custom_maps",
        sa.Column("heartbeat_at", sa.DateTime(timezone=True), nullable=True),
        schema="data",
    )
    op.alter_column("custom_maps", "status_error", new_column_name="status_errors", schema="data")
    op.execute(
        """
        UPDATE data.custom_maps
        SET status_errors = jsonb_build_array(status_errors)
        WHERE status_errors IS NOT NULL AND jsonb_typeof(status_errors) = 'object'
        """
    )


def downgrade() -> None:
    op.execute(
        """
        UPDATE data.custom_maps
        SET status_errors = status_errors -> -1
        WHERE status_errors IS NOT NULL AND jsonb_typeof(status_errors) = 'array'
        """
    )
    op.alter_column("custom_maps", "status_errors", new_column_name="status_error", schema="data")
    op.drop_column("custom_maps", "heartbeat_at", schema="data")
