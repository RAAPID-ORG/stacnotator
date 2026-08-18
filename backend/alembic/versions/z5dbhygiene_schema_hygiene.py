"""Schema hygiene: orphan purge, unique keys, FK indexes, tz timestamps.

Purges orphaned annotation_geometries (the app now deletes geometries with
their last referrer), constrains the viz keys the code already treats as
unique, renames campaign_users.is_authorative_reviewer to the correct spelling
(the API keeps the old wire name via a serialization alias), converts the two
remaining naive timestamps to timestamptz interpreting stored values as UTC,
drops the never-read embedding provenance columns, and indexes unindexed FKs.

Revision ID: z5dbhygiene
Revises: z3tswindows
Create Date: 2026-07-21 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "z5dbhygiene"
down_revision: str | Sequence[str] | None = "z3tswindows"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

FK_INDEXES: list[tuple[str, str, str]] = [
    ("idx_imagery_sources_campaign_id", "imagery_sources", "campaign_id"),
    ("idx_imagery_collections_source_id", "imagery_collections", "source_id"),
    ("idx_imagery_slices_collection_id", "imagery_slices", "collection_id"),
    ("idx_basemaps_campaign_id", "basemaps", "campaign_id"),
    ("idx_imagery_views_campaign_id", "imagery_views", "campaign_id"),
    ("idx_time_series_campaign_id", "time_series", "campaign_id"),
    ("idx_vector_layers_campaign_id", "vector_layers", "campaign_id"),
    ("idx_canvas_layouts_campaign_id", "canvas_layouts", "campaign_id"),
    ("idx_canvas_layouts_user_id", "canvas_layouts", "user_id"),
    ("idx_canvas_layouts_view_id", "canvas_layouts", "view_id"),
    ("idx_campaign_users_campaign_id", "campaign_users", "campaign_id"),
    ("idx_annotation_tasks_geometry_id", "annotation_tasks", "geometry_id"),
    ("idx_annotations_geometry_id", "annotations", "geometry_id"),
    ("idx_annotations_created_by_user_id", "annotations", "created_by_user_id"),
    ("idx_annotations_imagery_slice_id", "annotations", "imagery_slice_id"),
    ("idx_annotation_tasks_assignment_user_id", "annotation_tasks_assignment", "user_id"),
    ("idx_embeddings_annotation_task_id", "embeddings", "annotation_task_id"),
]


def upgrade() -> None:
    op.execute(
        """
        DELETE FROM data.annotation_geometries g
        WHERE NOT EXISTS (SELECT 1 FROM data.annotation_tasks t WHERE t.geometry_id = g.id)
          AND NOT EXISTS (SELECT 1 FROM data.annotations a WHERE a.geometry_id = g.id)
        """
    )

    # Duplicates can only stem from bugs (both tables are system-managed);
    # keep the oldest row per key before constraining.
    op.execute(
        """
        DELETE FROM data.slice_tile_urls s
        USING data.slice_tile_urls keep
        WHERE s.slice_id = keep.slice_id
          AND s.visualization_name = keep.visualization_name
          AND s.id > keep.id
        """
    )
    op.execute(
        """
        DELETE FROM data.visualization_templates v
        USING data.visualization_templates keep
        WHERE v.source_id = keep.source_id
          AND v.name = keep.name
          AND v.id > keep.id
        """
    )
    op.create_unique_constraint(
        "uq_slice_tile_urls_slice_viz",
        "slice_tile_urls",
        ["slice_id", "visualization_name"],
        schema="data",
    )
    op.create_unique_constraint(
        "uq_visualization_templates_source_name",
        "visualization_templates",
        ["source_id", "name"],
        schema="data",
    )

    op.alter_column(
        "campaign_users",
        "is_authorative_reviewer",
        new_column_name="is_authoritative_reviewer",
        schema="data",
    )

    for table in ("campaigns", "task_sets"):
        op.alter_column(
            table,
            "created_at",
            type_=sa.TIMESTAMP(timezone=True),
            postgresql_using="created_at AT TIME ZONE 'UTC'",
            schema="data",
        )

    # No creation path ever wrote NULL, and a campaign-less layout is
    # unreachable by every read path - drop any historical stragglers.
    op.execute("DELETE FROM data.canvas_layouts WHERE campaign_id IS NULL")
    op.alter_column("canvas_layouts", "campaign_id", nullable=False, schema="data")

    for column in ("lat", "lon", "period_start", "period_end"):
        op.drop_column("embeddings", column, schema="data")

    for name, table, column in FK_INDEXES:
        op.create_index(name, table, [column], schema="data")


def downgrade() -> None:
    for name, table, _ in FK_INDEXES:
        op.drop_index(name, table_name=table, schema="data")

    # Recreated nullable: the dropped provenance values are gone for existing rows.
    op.add_column("embeddings", sa.Column("lat", sa.Float(), nullable=True), schema="data")
    op.add_column("embeddings", sa.Column("lon", sa.Float(), nullable=True), schema="data")
    op.add_column(
        "embeddings",
        sa.Column("period_start", sa.TIMESTAMP(timezone=True), nullable=True),
        schema="data",
    )
    op.add_column(
        "embeddings",
        sa.Column("period_end", sa.TIMESTAMP(timezone=True), nullable=True),
        schema="data",
    )

    op.alter_column("canvas_layouts", "campaign_id", nullable=True, schema="data")

    for table in ("campaigns", "task_sets"):
        op.alter_column(
            table,
            "created_at",
            type_=sa.TIMESTAMP(timezone=False),
            postgresql_using="created_at AT TIME ZONE 'UTC'",
            schema="data",
        )

    op.alter_column(
        "campaign_users",
        "is_authoritative_reviewer",
        new_column_name="is_authorative_reviewer",
        schema="data",
    )

    op.drop_constraint(
        "uq_visualization_templates_source_name",
        "visualization_templates",
        schema="data",
    )
    op.drop_constraint("uq_slice_tile_urls_slice_viz", "slice_tile_urls", schema="data")
