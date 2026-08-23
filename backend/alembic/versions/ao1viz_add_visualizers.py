"""add visualizers: published maps over a project's registered imagery and overlays

A visualizer owns no imagery. It holds a name, a share slug, an opening camera
and a publish flag, plus ordered references to imagery sources and overlays that
belong to campaigns in the same project. The references cascade from those rows,
so deleting a campaign takes its layers off every visualizer that used them.

Revision ID: ao1viz
Revises: an1anndel
Create Date: 2026-08-23
"""

import sqlalchemy as sa

from alembic import op

revision = "ao1viz"
down_revision = "an1anndel"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "visualizers",
        sa.Column("id", sa.Integer(), sa.Identity(always=True), primary_key=True),
        sa.Column(
            "project_id",
            sa.Integer(),
            sa.ForeignKey("data.projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("slug", sa.String(length=24), nullable=False, unique=True),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("is_public", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("center_lon", sa.Float(), nullable=True),
        sa.Column("center_lat", sa.Float(), nullable=True),
        sa.Column("zoom", sa.Float(), nullable=True),
        sa.Column(
            "created_by",
            sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey("auth.users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.text("current_timestamp"),
            nullable=False,
        ),
        schema="data",
    )
    op.create_index("idx_visualizers_project_id", "visualizers", ["project_id"], schema="data")

    op.create_table(
        "visualizer_imagery",
        sa.Column("id", sa.Integer(), sa.Identity(always=True), primary_key=True),
        sa.Column(
            "visualizer_id",
            sa.Integer(),
            sa.ForeignKey("data.visualizers.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "source_id",
            sa.Integer(),
            sa.ForeignKey("data.imagery_sources.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("display_order", sa.SmallInteger(), server_default="0", nullable=False),
        sa.UniqueConstraint("visualizer_id", "source_id", name="uq_visualizer_imagery_source"),
        schema="data",
    )

    op.create_table(
        "visualizer_overlays",
        sa.Column("id", sa.Integer(), sa.Identity(always=True), primary_key=True),
        sa.Column(
            "visualizer_id",
            sa.Integer(),
            sa.ForeignKey("data.visualizers.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "custom_map_id",
            sa.Integer(),
            sa.ForeignKey("data.custom_maps.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column(
            "vector_layer_id",
            sa.Integer(),
            sa.ForeignKey("data.vector_layers.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("display_order", sa.SmallInteger(), server_default="0", nullable=False),
        sa.Column("visible", sa.Boolean(), server_default="true", nullable=False),
        sa.Column("opacity", sa.Float(), server_default="1", nullable=False),
        sa.CheckConstraint(
            "(custom_map_id IS NULL) <> (vector_layer_id IS NULL)",
            name="visualizer_overlays_one_target_check",
        ),
        sa.CheckConstraint("opacity BETWEEN 0 AND 1", name="visualizer_overlays_opacity_check"),
        schema="data",
    )
    op.create_index(
        "idx_visualizer_overlays_visualizer_id",
        "visualizer_overlays",
        ["visualizer_id"],
        schema="data",
    )


def downgrade() -> None:
    op.drop_table("visualizer_overlays", schema="data")
    op.drop_table("visualizer_imagery", schema="data")
    op.drop_table("visualizers", schema="data")
