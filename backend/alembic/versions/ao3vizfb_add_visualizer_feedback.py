"""somewhere for a published map to take feedback

Feedback is about a place on a published map rather than about the map itself,
so it carries a box. The layer it names and the class it proposes are
snapshotted as text beside their ids, because a legend can be recoloured and a
layer removed while the remark still has to read.

Its own revision rather than part of ao2vizown: that one had already been
applied by the time feedback existed, and an applied migration is history.

Revision ID: ao3vizfb
Revises: ao2vizown
Create Date: 2026-08-23
"""

import sqlalchemy as sa

from alembic import op

revision = "ao3vizfb"
down_revision = "ao2vizown"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "visualizer_feedback",
        sa.Column("id", sa.Integer(), sa.Identity(always=True), primary_key=True),
        sa.Column(
            "visualizer_id",
            sa.Integer(),
            sa.ForeignKey("data.visualizers.id", ondelete="CASCADE"),
            nullable=False,
        ),
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
        sa.Column("bbox_west", sa.Float(), nullable=False),
        sa.Column("bbox_south", sa.Float(), nullable=False),
        sa.Column("bbox_east", sa.Float(), nullable=False),
        sa.Column("bbox_north", sa.Float(), nullable=False),
        sa.Column(
            "overlay_id",
            sa.Integer(),
            sa.ForeignKey("data.visualizer_overlays.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("layer_name", sa.String(length=255), nullable=True),
        sa.Column("suggested_value", sa.Integer(), nullable=True),
        sa.Column("suggested_label", sa.String(length=255), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("viewing", sa.String(length=255), nullable=True),
        sa.CheckConstraint("bbox_west BETWEEN -180 AND 180", name="feedback_bbox_west_range"),
        sa.CheckConstraint("bbox_east BETWEEN -180 AND 180", name="feedback_bbox_east_range"),
        sa.CheckConstraint("bbox_south BETWEEN -90 AND 90", name="feedback_bbox_south_range"),
        sa.CheckConstraint("bbox_north BETWEEN -90 AND 90", name="feedback_bbox_north_range"),
        sa.CheckConstraint("bbox_west < bbox_east", name="feedback_bbox_lon_order"),
        sa.CheckConstraint("bbox_south < bbox_north", name="feedback_bbox_lat_order"),
        sa.CheckConstraint(
            "suggested_label IS NOT NULL OR note IS NOT NULL",
            name="feedback_says_something_check",
        ),
        schema="data",
    )
    op.create_index(
        "idx_visualizer_feedback_visualizer_id",
        "visualizer_feedback",
        ["visualizer_id"],
        schema="data",
    )


def downgrade() -> None:
    op.drop_table("visualizer_feedback", schema="data")
