"""A task row lives exactly as long as its task

Deleting a task used to null the link on its rows and leave them behind: an
outcome with no task, a skip with no label drawn on the Explore map. A labelled
row becomes a shape of its own; every other orphaned row is removed, and the
link now cascades so the database keeps it that way.

Revision ID: av9taskrows
Revises: av8tiler
Create Date: 2026-10-23
"""

from collections.abc import Sequence

from alembic import op

revision: str = "av9taskrows"
down_revision: str | Sequence[str] | None = "av8tiler"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        "UPDATE data.annotations SET outcome = NULL "
        "WHERE annotation_task_id IS NULL AND outcome = 'labelled'"
    )
    op.execute(
        "UPDATE data.campaigns c SET annotations_version = annotations_version + 1 "
        "WHERE EXISTS (SELECT 1 FROM data.annotations a "
        "WHERE a.campaign_id = c.id AND a.annotation_task_id IS NULL AND a.outcome IS NOT NULL)"
    )
    op.execute(
        "DELETE FROM data.annotations WHERE annotation_task_id IS NULL AND outcome IS NOT NULL"
    )
    op.execute(
        "DELETE FROM data.annotation_geometries g "
        "WHERE NOT EXISTS (SELECT 1 FROM data.annotations a WHERE a.geometry_id = g.id) "
        "AND NOT EXISTS (SELECT 1 FROM data.annotation_tasks t WHERE t.geometry_id = g.id)"
    )
    op.drop_constraint("annotations_task_row_has_outcome", "annotations", schema="data")
    op.create_check_constraint(
        "annotations_task_row_has_outcome",
        "annotations",
        "(annotation_task_id IS NULL) = (outcome IS NULL)",
        schema="data",
    )
    op.drop_constraint("annotations_annotation_task_id_fkey", "annotations", schema="data")
    op.create_foreign_key(
        "annotations_annotation_task_id_fkey",
        "annotations",
        "annotation_tasks",
        ["annotation_task_id"],
        ["id"],
        source_schema="data",
        referent_schema="data",
        ondelete="CASCADE",
    )


def downgrade() -> None:
    op.drop_constraint("annotations_annotation_task_id_fkey", "annotations", schema="data")
    op.create_foreign_key(
        "annotations_annotation_task_id_fkey",
        "annotations",
        "annotation_tasks",
        ["annotation_task_id"],
        ["id"],
        source_schema="data",
        referent_schema="data",
        ondelete="SET NULL",
    )
    op.drop_constraint("annotations_task_row_has_outcome", "annotations", schema="data")
    op.create_check_constraint(
        "annotations_task_row_has_outcome",
        "annotations",
        "annotation_task_id IS NULL OR outcome IS NOT NULL",
        schema="data",
    )
