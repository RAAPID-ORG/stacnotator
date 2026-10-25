"""The task poll reports what leaves no annotation row to read

The poll found changed tasks only through their annotations' updated_at, so a
deleted answer, an assignment change or a deleted task never reached other
annotators. tasks.changed_at is stamped for the first two, and deleted tasks
get tombstones like deleted annotations.

Revision ID: avPtasksync
Revises: avNcmtiler
Create Date: 2026-10-25
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "avPtasksync"
down_revision: str | Sequence[str] | None = "avNcmtiler"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "tasks",
        sa.Column(
            "changed_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        schema="data",
    )
    op.create_index(
        "idx_tasks_campaign_changed_at", "tasks", ["campaign_id", "changed_at"], schema="data"
    )
    op.create_table(
        "deleted_tasks",
        sa.Column("task_id", sa.Integer(), primary_key=True, autoincrement=False),
        sa.Column(
            "campaign_id",
            sa.Integer(),
            sa.ForeignKey("data.campaigns.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "deleted_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        schema="data",
    )
    op.create_index(
        "idx_deleted_tasks_campaign_deleted_at",
        "deleted_tasks",
        ["campaign_id", "deleted_at"],
        schema="data",
    )


def downgrade() -> None:
    op.drop_index(
        "idx_deleted_tasks_campaign_deleted_at", table_name="deleted_tasks", schema="data"
    )
    op.drop_table("deleted_tasks", schema="data")
    op.drop_index("idx_tasks_campaign_changed_at", table_name="tasks", schema="data")
    op.drop_column("tasks", "changed_at", schema="data")
