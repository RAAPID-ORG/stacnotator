"""Geometry and embeddings on the rows they belong to

A task and every annotation pointed at a shared row in annotation_geometries, and a
task's answers pointed at the task's own row. Since an answer's shape can be edited
on its own, the sharing bought nothing but reference counting: deleting anything had
to sweep geometries no longer referenced. Each row now carries its geometry; an
answer starts out with a copy of its task's. A task's embedding, a 1:1 side table,
becomes a column of the task.

Revision ID: avEinline
Revises: avDmosaics
Create Date: 2026-10-23
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from geoalchemy2 import Geometry
from pgvector.sqlalchemy import Vector

revision: str = "avEinline"
down_revision: str | Sequence[str] | None = "avDmosaics"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

ROWS = ("annotation_tasks", "annotations")


def _geometry() -> Geometry:
    return Geometry(geometry_type="GEOMETRY", srid=4326, spatial_index=False)


def upgrade() -> None:
    for table in ROWS:
        op.add_column(table, sa.Column("geometry", _geometry(), nullable=True), schema="data")
        op.execute(
            f"""
            UPDATE data.{table} r SET geometry = g.geometry
            FROM data.annotation_geometries g WHERE g.id = r.geometry_id
            """  # noqa: S608
        )
        op.alter_column(table, "geometry", nullable=False, schema="data")
        op.create_index(
            f"idx_{table}_geometry", table, ["geometry"], postgresql_using="gist", schema="data"
        )
        op.drop_column(table, "geometry_id", schema="data")
    op.drop_table("annotation_geometries", schema="data")

    op.add_column(
        "annotation_tasks", sa.Column("embedding", Vector(64), nullable=True), schema="data"
    )
    op.execute(
        """
        UPDATE data.annotation_tasks t SET embedding = e.vector
        FROM (
            SELECT DISTINCT ON (annotation_task_id) annotation_task_id, vector
            FROM data.embeddings ORDER BY annotation_task_id, id DESC
        ) e
        WHERE e.annotation_task_id = t.id
        """
    )
    op.create_index(
        "idx_annotation_tasks_embedding_cosine",
        "annotation_tasks",
        ["embedding"],
        postgresql_using="hnsw",
        postgresql_with={"m": 16, "ef_construction": 64},
        postgresql_ops={"embedding": "vector_cosine_ops"},
        schema="data",
    )
    op.drop_table("embeddings", schema="data")


def downgrade() -> None:
    op.create_table(
        "embeddings",
        sa.Column("id", sa.Integer(), sa.Identity(always=True), primary_key=True),
        sa.Column(
            "annotation_task_id",
            sa.Integer(),
            sa.ForeignKey("data.annotation_tasks.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("vector", Vector(64), nullable=False),
        schema="data",
    )
    op.execute(
        """
        INSERT INTO data.embeddings (annotation_task_id, vector)
        SELECT id, embedding FROM data.annotation_tasks WHERE embedding IS NOT NULL
        """
    )
    op.create_index(
        "idx_embeddings_annotation_task_id", "embeddings", ["annotation_task_id"], schema="data"
    )
    op.create_index(
        "idx_embeddings_vector_cosine",
        "embeddings",
        ["vector"],
        postgresql_using="hnsw",
        postgresql_with={"m": 16, "ef_construction": 64},
        postgresql_ops={"vector": "vector_cosine_ops"},
        schema="data",
    )
    op.drop_index("idx_annotation_tasks_embedding_cosine", "annotation_tasks", schema="data")
    op.drop_column("annotation_tasks", "embedding", schema="data")

    op.create_table(
        "annotation_geometries",
        sa.Column("id", sa.Integer(), sa.Identity(always=True), primary_key=True),
        sa.Column("geometry", _geometry(), nullable=False),
        sa.Column("source_table", sa.Text(), nullable=True),
        sa.Column("source_id", sa.Integer(), nullable=True),
        schema="data",
    )
    op.create_index(
        "idx_annotation_geometries_geometry",
        "annotation_geometries",
        ["geometry"],
        postgresql_using="gist",
        schema="data",
    )
    for table in ROWS:
        op.execute(
            f"""
            INSERT INTO data.annotation_geometries (geometry, source_table, source_id)
            SELECT geometry, '{table}', id FROM data.{table}
            """  # noqa: S608
        )
        op.add_column(table, sa.Column("geometry_id", sa.Integer(), nullable=True), schema="data")
        op.execute(
            f"""
            UPDATE data.{table} r SET geometry_id = g.id
            FROM data.annotation_geometries g
            WHERE g.source_table = '{table}' AND g.source_id = r.id
            """  # noqa: S608
        )
        op.alter_column(table, "geometry_id", nullable=False, schema="data")
        op.create_foreign_key(
            f"{table}_geometry_id_fkey",
            table,
            "annotation_geometries",
            ["geometry_id"],
            ["id"],
            source_schema="data",
            referent_schema="data",
            ondelete="CASCADE",
        )
        op.create_index(f"idx_{table}_geometry_id", table, ["geometry_id"], schema="data")
        op.drop_index(f"idx_{table}_geometry", table, schema="data")
        op.drop_column(table, "geometry", schema="data")
    op.drop_column("annotation_geometries", "source_table", schema="data")
    op.drop_column("annotation_geometries", "source_id", schema="data")
