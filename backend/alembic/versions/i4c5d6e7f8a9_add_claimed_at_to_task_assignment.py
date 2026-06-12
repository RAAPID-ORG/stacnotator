"""add_claimed_at_to_task_assignment

Revision ID: i4c5d6e7f8a9
Revises: h3b4c5d6e7f8
Create Date: 2026-06-12 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "i4c5d6e7f8a9"
down_revision: str | Sequence[str] | None = "h3b4c5d6e7f8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "annotation_tasks_assignment",
        sa.Column("claimed_at", sa.DateTime(timezone=True), nullable=True),
        schema="data",
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("annotation_tasks_assignment", "claimed_at", schema="data")
