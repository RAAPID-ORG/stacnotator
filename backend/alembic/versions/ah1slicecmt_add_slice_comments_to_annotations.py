"""add per-slice comments to annotations

Revision ID: ah1slicecmt
Revises: ag1srczoom
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "ah1slicecmt"
down_revision: str | Sequence[str] | None = "ag1srczoom"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "annotations",
        sa.Column("slice_comments", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        schema="data",
    )


def downgrade() -> None:
    op.drop_column("annotations", "slice_comments", schema="data")
