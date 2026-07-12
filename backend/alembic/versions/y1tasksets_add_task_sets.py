"""task sets: group annotation tasks per campaign

Revision ID: y1tasksets
Revises: x2intstore
Create Date: 2026-07-10 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "y1tasksets"
down_revision: str | Sequence[str] | None = "x2intstore"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "task_sets",
        sa.Column("id", sa.Integer(), sa.Identity(always=True), nullable=False),
        sa.Column(
            "campaign_id",
            sa.Integer(),
            sa.ForeignKey("data.campaigns.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("campaign_id", "name"),
        schema="data",
    )
    op.create_index("idx_task_sets_campaign_id", "task_sets", ["campaign_id"], schema="data")

    op.add_column(
        "annotation_tasks", sa.Column("task_set_id", sa.Integer(), nullable=True), schema="data"
    )
    # Every existing campaign gets one Default set; all its tasks move into it.
    op.execute("INSERT INTO data.task_sets (campaign_id, name) SELECT id, 'Default' FROM data.campaigns")
    op.execute(
        "UPDATE data.annotation_tasks t SET task_set_id = s.id "
        "FROM data.task_sets s WHERE s.campaign_id = t.campaign_id"
    )
    op.create_foreign_key(
        "annotation_tasks_task_set_id_fkey",
        "annotation_tasks",
        "task_sets",
        ["task_set_id"],
        ["id"],
        source_schema="data",
        referent_schema="data",
        ondelete="CASCADE",
    )
    op.alter_column("annotation_tasks", "task_set_id", nullable=False, schema="data")
    op.create_index(
        "idx_annotation_tasks_task_set_id", "annotation_tasks", ["task_set_id"], schema="data"
    )


def downgrade() -> None:
    op.drop_index("idx_annotation_tasks_task_set_id", "annotation_tasks", schema="data")
    op.drop_column("annotation_tasks", "task_set_id", schema="data")
    op.drop_index("idx_task_sets_campaign_id", "task_sets", schema="data")
    op.drop_table("task_sets", schema="data")
