"""Tasks are called tasks in the database too

``annotation_tasks`` and ``annotation_tasks_assignment`` become ``tasks`` and
``task_assignments``, and the answer's link ``annotations.annotation_task_id``
becomes ``annotations.task_id``. Their keys, indexes, constraints and sequences
follow. Those names differ between databases built at different times (an
``annotation_tasks_pkey1`` here, an ``idx_task_items_campaign_id`` there), so
they are renamed by what they contain rather than from a fixed list.

Revision ID: avGtasks
Revises: avFwindows
Create Date: 2026-10-24
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "avGtasks"
down_revision: str | Sequence[str] | None = "avFwindows"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

UP_TABLES = [("annotation_tasks_assignment", "task_assignments"), ("annotation_tasks", "tasks")]
UP_NAMES = {
    "task_assignments": [("annotation_tasks_assignment", "task_assignments")],
    "tasks": [("annotation_tasks", "tasks"), ("task_items", "tasks")],
    "annotations": [
        ("annotations_annotation_task_id", "annotations_task_id"),
        ("uq_annotation_task_user", "uq_annotations_task_user"),
    ],
}
DOWN_NAMES = {
    "annotation_tasks_assignment": [("task_assignments", "annotation_tasks_assignment")],
    "annotation_tasks": [("tasks", "annotation_tasks")],
    "annotations": [
        ("annotations_task_id_fkey", "annotations_annotation_task_id_fkey"),
        ("uq_annotations_task_user", "uq_annotation_task_user"),
    ],
}


def _rename_objects(table: str, rules: list[tuple[str, str]]) -> None:
    """Rename the table's constraints, then its remaining indexes and its sequences,
    replacing each rule's old fragment with its new one."""

    def renamed(name: str) -> str:
        for old, new in rules:
            name = name.replace(old, new)
        return name

    conn = op.get_bind()
    constraints = conn.execute(
        sa.text(
            "SELECT conname FROM pg_constraint "
            "WHERE conrelid = to_regclass(:table) AND contype IN ('p', 'u', 'f', 'c')"
        ),
        {"table": f"data.{table}"},
    ).scalars()
    for name in list(constraints):
        if renamed(name) != name:
            op.execute(f'ALTER TABLE data.{table} RENAME CONSTRAINT "{name}" TO "{renamed(name)}"')
    # A constraint's own index was renamed with it.
    indexes = conn.execute(
        sa.text(
            "SELECT c.relname FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid "
            "WHERE i.indrelid = to_regclass(:table) "
            "AND NOT EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conindid = i.indexrelid)"
        ),
        {"table": f"data.{table}"},
    ).scalars()
    for name in list(indexes):
        if renamed(name) != name:
            op.execute(f'ALTER INDEX data."{name}" RENAME TO "{renamed(name)}"')
    sequences = conn.execute(
        sa.text(
            "SELECT s.relname FROM pg_class s "
            "JOIN pg_depend d ON d.objid = s.oid AND d.classid = 'pg_class'::regclass "
            "WHERE s.relkind = 'S' AND d.refobjid = to_regclass(:table)"
        ),
        {"table": f"data.{table}"},
    ).scalars()
    for name in list(sequences):
        if renamed(name) != name:
            op.execute(f'ALTER SEQUENCE data."{name}" RENAME TO "{renamed(name)}"')


def upgrade() -> None:
    for old, new in UP_TABLES:
        op.rename_table(old, new, schema="data")
    op.alter_column("annotations", "annotation_task_id", new_column_name="task_id", schema="data")
    for table, rules in UP_NAMES.items():
        _rename_objects(table, rules)


def downgrade() -> None:
    op.alter_column("annotations", "task_id", new_column_name="annotation_task_id", schema="data")
    for old, new in UP_TABLES:
        op.rename_table(new, old, schema="data")
    for table, rules in DOWN_NAMES.items():
        _rename_objects(table, rules)
