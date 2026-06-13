"""add_imagery_snapshot_to_annotations

Revision ID: j5d6e7f8a9b0
Revises: i4c5d6e7f8a9
Create Date: 2026-06-13 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "j5d6e7f8a9b0"
down_revision: str | Sequence[str] | None = "i4c5d6e7f8a9"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "annotations",
        sa.Column("imagery_slice_id", sa.Integer(), nullable=True),
        schema="data",
    )
    op.add_column(
        "annotations",
        sa.Column("imagery_source_name", sa.String(), nullable=True),
        schema="data",
    )
    op.add_column(
        "annotations",
        sa.Column("imagery_start_date", sa.String(length=10), nullable=True),
        schema="data",
    )
    op.add_column(
        "annotations",
        sa.Column("imagery_end_date", sa.String(length=10), nullable=True),
        schema="data",
    )
    op.create_foreign_key(
        "fk_annotations_imagery_slice_id",
        "annotations",
        "imagery_slices",
        ["imagery_slice_id"],
        ["id"],
        source_schema="data",
        referent_schema="data",
        ondelete="SET NULL",
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint(
        "fk_annotations_imagery_slice_id",
        "annotations",
        schema="data",
        type_="foreignkey",
    )
    op.drop_column("annotations", "imagery_end_date", schema="data")
    op.drop_column("annotations", "imagery_start_date", schema="data")
    op.drop_column("annotations", "imagery_source_name", schema="data")
    op.drop_column("annotations", "imagery_slice_id", schema="data")
