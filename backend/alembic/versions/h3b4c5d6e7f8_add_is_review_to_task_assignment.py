"""add_is_review_to_task_assignment

Revision ID: h3b4c5d6e7f8
Revises: e2f3a4b5c6d7
Create Date: 2026-06-11 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "h3b4c5d6e7f8"
down_revision: str | Sequence[str] | None = "e2f3a4b5c6d7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "annotation_tasks_assignment",
        sa.Column("is_review", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        schema="data",
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("annotation_tasks_assignment", "is_review", schema="data")
