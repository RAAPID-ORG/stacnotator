"""Draw tasks: a campaign's tasks are finished by a label or by drawn shapes.

Every task row records its outcome explicitly, so a skip no longer has to be
read off a missing label. Shapes drawn as a draw task's answer link to it
through their own column, apart from the shapes Explore found near a task.

Revision ID: au1taskoutput
Revises: at1mapaccess
Create Date: 2026-10-22
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "au1taskoutput"
down_revision: str | Sequence[str] | None = "at1mapaccess"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "settings",
        sa.Column(
            "task_output", sa.String(20), server_default=sa.text("'classify'"), nullable=False
        ),
        schema="data",
    )
    op.create_check_constraint(
        "settings_task_output_values",
        "settings",
        "task_output IN ('classify', 'draw')",
        schema="data",
    )

    op.add_column(
        "annotations",
        sa.Column("output_of_task_id", sa.Integer(), nullable=True),
        schema="data",
    )
    op.create_foreign_key(
        "annotations_output_of_task_id_fkey",
        "annotations",
        "annotation_tasks",
        ["output_of_task_id"],
        ["id"],
        source_schema="data",
        referent_schema="data",
        ondelete="SET NULL",
    )
    op.create_index(
        "idx_annotations_output_of_task_id", "annotations", ["output_of_task_id"], schema="data"
    )
    op.drop_constraint(
        "annotations_origin_only_standalone", "annotations", schema="data", type_="check"
    )
    op.create_check_constraint(
        "annotations_single_task_link",
        "annotations",
        "num_nonnulls(annotation_task_id, origin_task_id, output_of_task_id) <= 1",
        schema="data",
    )

    op.add_column("annotations", sa.Column("outcome", sa.String(20), nullable=True), schema="data")
    op.execute(
        "UPDATE data.annotations "
        "SET outcome = CASE WHEN label_id IS NULL THEN 'skipped' ELSE 'labelled' END "
        "WHERE annotation_task_id IS NOT NULL"
    )
    op.create_check_constraint(
        "annotations_outcome_values",
        "annotations",
        "outcome IS NULL OR outcome IN ('labelled', 'skipped', 'drawn', 'none_found')",
        schema="data",
    )
    op.create_check_constraint(
        "annotations_task_row_has_outcome",
        "annotations",
        "annotation_task_id IS NULL OR outcome IS NOT NULL",
        schema="data",
    )
    op.create_check_constraint(
        "annotations_outcome_label_match",
        "annotations",
        "outcome IS NULL OR (outcome = 'labelled') = (label_id IS NOT NULL)",
        schema="data",
    )


def downgrade() -> None:
    for name in (
        "annotations_outcome_label_match",
        "annotations_task_row_has_outcome",
        "annotations_outcome_values",
    ):
        op.drop_constraint(name, "annotations", schema="data", type_="check")
    op.drop_column("annotations", "outcome", schema="data")

    # The old schema has nowhere to put a draw task's shapes.
    op.execute(
        "INSERT INTO data.deleted_annotations (annotation_id, campaign_id) "
        "SELECT id, campaign_id FROM data.annotations WHERE output_of_task_id IS NOT NULL "
        "ON CONFLICT DO NOTHING"
    )
    op.execute("DELETE FROM data.annotations WHERE output_of_task_id IS NOT NULL")
    op.drop_constraint("annotations_single_task_link", "annotations", schema="data", type_="check")
    op.create_check_constraint(
        "annotations_origin_only_standalone",
        "annotations",
        "annotation_task_id IS NULL OR origin_task_id IS NULL",
        schema="data",
    )
    op.drop_index("idx_annotations_output_of_task_id", table_name="annotations", schema="data")
    op.drop_constraint(
        "annotations_output_of_task_id_fkey", "annotations", schema="data", type_="foreignkey"
    )
    op.drop_column("annotations", "output_of_task_id", schema="data")

    op.drop_constraint("settings_task_output_values", "settings", schema="data", type_="check")
    op.drop_column("settings", "task_output", schema="data")
