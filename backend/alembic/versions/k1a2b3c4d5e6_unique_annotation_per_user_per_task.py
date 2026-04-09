"""add unique constraint on (annotation_task_id, created_by_user_id)

Revision ID: k1a2b3c4d5e6
Revises: j1a2b3c4d5e6
Create Date: 2026-04-09
"""

from alembic import op

revision = "k1a2b3c4d5e6"
down_revision = "j1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Partial unique constraint: only applies when annotation_task_id is NOT NULL
    # (standalone annotations without a task are not affected).
    # Prevents duplicate annotations per (task, user) from race conditions.
    op.create_unique_constraint(
        "uq_annotation_task_user",
        "annotations",
        ["annotation_task_id", "created_by_user_id"],
        schema="data",
    )


def downgrade() -> None:
    op.drop_constraint(
        "uq_annotation_task_user",
        "annotations",
        schema="data",
        type_="unique",
    )
