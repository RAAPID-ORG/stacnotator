"""add_source_id_to_annotations

Revision ID: k6e7f8a9b0c1
Revises: j5d6e7f8a9b0
Create Date: 2026-06-13 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "k6e7f8a9b0c1"
down_revision: str | Sequence[str] | None = "j5d6e7f8a9b0"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "annotations",
        sa.Column("source_id", sa.Integer(), nullable=True),
        schema="data",
    )
    op.create_unique_constraint(
        "uq_annotation_campaign_source",
        "annotations",
        ["campaign_id", "source_id"],
        schema="data",
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint(
        "uq_annotation_campaign_source",
        "annotations",
        schema="data",
        type_="unique",
    )
    op.drop_column("annotations", "source_id", schema="data")
