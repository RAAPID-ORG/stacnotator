"""split soft claims out of task assignments

A claim is a lease, an assignment is admin intent, and the work itself is the
annotation. Claims move onto annotation_tasks, per-user time moves onto the
annotation, and assignment status becomes derived, so an assignment row means
only "an admin put this user on this task".

Revision ID: ai1claimsplit
Revises: ah1slicecmt
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "ai1claimsplit"
down_revision: str | Sequence[str] | None = "ah1slicecmt"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "annotation_tasks",
        sa.Column(
            "claimed_by_user_id",
            sa.UUID(),
            sa.ForeignKey("auth.users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        schema="data",
    )
    op.add_column(
        "annotation_tasks",
        sa.Column("claimed_at", sa.DateTime(timezone=True), nullable=True),
        schema="data",
    )
    op.add_column(
        "annotations",
        sa.Column("active_seconds", sa.Integer(), nullable=True),
        schema="data",
    )

    op.execute(
        """
        UPDATE data.annotations a
        SET active_seconds = t.active_seconds
        FROM data.annotation_tasks_assignment t
        WHERE t.task_id = a.annotation_task_id
          AND t.user_id = a.created_by_user_id
          AND t.active_seconds IS NOT NULL
        """
    )

    # A skip used to live only as assignment.status; it now needs an annotation
    # to survive, or the task would silently return to the pending pool.
    op.execute(
        """
        INSERT INTO data.annotations (
            geometry_id, campaign_id, created_by_user_id, annotation_task_id, active_seconds
        )
        SELECT task.geometry_id, task.campaign_id, asg.user_id, task.id, asg.active_seconds
        FROM data.annotation_tasks_assignment asg
        JOIN data.annotation_tasks task ON task.id = asg.task_id
        WHERE asg.status = 'skipped'
          AND NOT EXISTS (
              SELECT 1 FROM data.annotations a
              WHERE a.annotation_task_id = asg.task_id
                AND a.created_by_user_id = asg.user_id
          )
        """
    )

    # Live leases are worthless after the TTL, so they are dropped rather than
    # carried over; the holders simply re-claim on their next request.
    op.execute("DELETE FROM data.annotation_tasks_assignment WHERE claimed_at IS NOT NULL")

    op.drop_column("annotation_tasks_assignment", "claimed_at", schema="data")
    op.drop_column("annotation_tasks_assignment", "active_seconds", schema="data")
    op.drop_column("annotation_tasks_assignment", "status", schema="data")

    op.create_index(
        "uq_annotation_tasks_one_claim_per_user",
        "annotation_tasks",
        ["campaign_id", "claimed_by_user_id"],
        unique=True,
        schema="data",
        postgresql_where=sa.text("claimed_by_user_id IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index(
        "uq_annotation_tasks_one_claim_per_user",
        table_name="annotation_tasks",
        schema="data",
    )
    op.add_column(
        "annotation_tasks_assignment",
        sa.Column("status", sa.String(length=32), nullable=False, server_default="pending"),
        schema="data",
    )
    op.add_column(
        "annotation_tasks_assignment",
        sa.Column("active_seconds", sa.Integer(), nullable=True),
        schema="data",
    )
    op.add_column(
        "annotation_tasks_assignment",
        sa.Column("claimed_at", sa.DateTime(timezone=True), nullable=True),
        schema="data",
    )

    # Rebuild what is rebuildable: status from the annotations it was derived
    # from, and time from the annotation it was moved to. Claims are gone for
    # good, which costs nothing beyond one re-claim per active annotator.
    op.execute(
        """
        UPDATE data.annotation_tasks_assignment asg
        SET status = CASE WHEN a.label_id IS NULL THEN 'skipped' ELSE 'done' END,
            active_seconds = a.active_seconds
        FROM data.annotations a
        WHERE a.annotation_task_id = asg.task_id
          AND a.created_by_user_id = asg.user_id
        """
    )

    op.drop_column("annotations", "active_seconds", schema="data")
    op.drop_column("annotation_tasks", "claimed_at", schema="data")
    op.drop_column("annotation_tasks", "claimed_by_user_id", schema="data")
