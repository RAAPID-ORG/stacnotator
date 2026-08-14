"""add_active_seconds_to_assignment

Revision ID: af1tasktime
Revises: ae1orgkeys
Create Date: 2026-08-14 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "af1tasktime"
down_revision: str | Sequence[str] | None = "ae1orgkeys"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "annotation_tasks_assignment",
        sa.Column("active_seconds", sa.Integer(), nullable=True),
        schema="data",
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("annotation_tasks_assignment", "active_seconds", schema="data")
