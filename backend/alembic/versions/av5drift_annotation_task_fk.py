"""Bring the database in line with the models.

- annotations.annotation_task_id lost its foreign key in cf49671afcb5 on
  databases built from scratch: the column was re-added without one. Rows
  pointing at a task that no longer exists are detached first, which is what the
  key's ON DELETE SET NULL would have done.
- annotation_geometries carries two identical GiST indexes on geometry: the one
  geoalchemy creates with the table and ix_annotation_geometries_geom from
  t1annotgist. The model's is kept.

Both steps check what is there first, since databases differ in which of these
they already have.

Revision ID: av5drift
Revises: av4tsclean
Create Date: 2026-10-23
"""

from collections.abc import Sequence

from alembic import op

revision: str = "av5drift"
down_revision: str | Sequence[str] | None = "av4tsclean"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1
                FROM pg_constraint c
                JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
                WHERE c.conrelid = 'data.annotations'::regclass
                  AND c.contype = 'f'
                  AND a.attname = 'annotation_task_id'
            ) THEN
                UPDATE data.annotations a SET annotation_task_id = NULL
                WHERE annotation_task_id IS NOT NULL
                  AND NOT EXISTS (
                      SELECT 1 FROM data.annotation_tasks t WHERE t.id = a.annotation_task_id
                  );
                ALTER TABLE data.annotations
                    ADD CONSTRAINT annotations_annotation_task_id_fkey
                    FOREIGN KEY (annotation_task_id) REFERENCES data.annotation_tasks (id)
                    ON DELETE SET NULL;
            END IF;
        END $$;
        """
    )
    with op.get_context().autocommit_block():
        op.execute(
            "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_annotation_geometries_geometry "
            "ON data.annotation_geometries USING GIST (geometry)"
        )
        op.execute("DROP INDEX CONCURRENTLY IF EXISTS data.ix_annotation_geometries_geom")


def downgrade() -> None:
    pass
