"""Standalone annotations remember the task the annotator came from.

Revision ID: as1origintask
Revises: ar1storacc
Create Date: 2026-10-08 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "as1origintask"
down_revision: str | Sequence[str] | None = "ar1storacc"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "annotations",
        sa.Column("origin_task_id", sa.Integer(), nullable=True),
        schema="data",
    )
    op.create_foreign_key(
        "annotations_origin_task_id_fkey",
        "annotations",
        "annotation_tasks",
        ["origin_task_id"],
        ["id"],
        source_schema="data",
        referent_schema="data",
        ondelete="SET NULL",
    )
    op.create_index(
        "idx_annotations_origin_task_id", "annotations", ["origin_task_id"], schema="data"
    )
    op.create_check_constraint(
        "annotations_origin_only_standalone",
        "annotations",
        "annotation_task_id IS NULL OR origin_task_id IS NULL",
        schema="data",
    )


def downgrade() -> None:
    op.drop_constraint(
        "annotations_origin_only_standalone", "annotations", schema="data", type_="check"
    )
    op.drop_index("idx_annotations_origin_task_id", table_name="annotations", schema="data")
    op.drop_constraint(
        "annotations_origin_task_id_fkey", "annotations", schema="data", type_="foreignkey"
    )
    op.drop_column("annotations", "origin_task_id", schema="data")
