"""give a visualizer an area, imagery of its own, and somewhere to take feedback

Two changes that only make sense together. An area replaces the stored camera:
it answers where the visualizer opens, how far out is too far to still be
looking at the data, and - the reason it is load-bearing - what extent its own
STAC searches are registered over.

Imagery sources gain a second possible owner. A source belongs to exactly one of
a campaign or a visualizer, so a visualizer can be built from any data without a
campaign existing first. Tiles are scoped by the owner rather than by the
campaign id (see imagery.models.SourceOwner), and the visualizer tracks its own
registration run the way a campaign tracks its.

Feedback is about a place on a published map rather than about the map, so it
carries a box. The layer it names and the class it proposes are snapshotted as
text beside their ids, because a legend can be recoloured and a layer removed
while the remark still has to read.

Revision ID: ao2vizown
Revises: ao1viz
Create Date: 2026-08-23
"""

import sqlalchemy as sa

from alembic import op

revision = "ao2vizown"
down_revision = "ao1viz"
branch_labels = None
depends_on = None


BOUNDS = (
    ("bbox_west", "bbox_west BETWEEN -180 AND 180"),
    ("bbox_south", "bbox_south BETWEEN -90 AND 90"),
    ("bbox_east", "bbox_east BETWEEN -180 AND 180"),
    ("bbox_north", "bbox_north BETWEEN -90 AND 90"),
)


def upgrade() -> None:
    for column, condition in BOUNDS:
        op.add_column("visualizers", sa.Column(column, sa.Float(), nullable=True), schema="data")
        op.create_check_constraint(
            f"visualizers_{column}_range", "visualizers", condition, schema="data"
        )
    op.create_check_constraint(
        "visualizers_bbox_lon_order", "visualizers", "bbox_west < bbox_east", schema="data"
    )
    op.create_check_constraint(
        "visualizers_bbox_lat_order", "visualizers", "bbox_south < bbox_north", schema="data"
    )
    op.create_check_constraint(
        "visualizers_bbox_all_or_none",
        "visualizers",
        "num_nonnulls(bbox_west, bbox_south, bbox_east, bbox_north) IN (0, 4)",
        schema="data",
    )

    op.drop_column("visualizers", "center_lon", schema="data")
    op.drop_column("visualizers", "center_lat", schema="data")
    op.drop_column("visualizers", "zoom", schema="data")

    op.add_column(
        "visualizers",
        sa.Column(
            "registration_status", sa.String(length=20), server_default="ready", nullable=False
        ),
        schema="data",
    )
    op.add_column(
        "visualizers",
        sa.Column("registration_heartbeat_at", sa.TIMESTAMP(timezone=True), nullable=True),
        schema="data",
    )
    op.add_column(
        "visualizers",
        sa.Column(
            "registration_errors",
            sa.dialects.postgresql.JSONB(none_as_null=True),
            nullable=True,
        ),
        schema="data",
    )

    # Every existing source belongs to a campaign, so the check holds from the
    # moment it is added.
    op.alter_column("imagery_sources", "campaign_id", nullable=True, schema="data")
    op.add_column(
        "imagery_sources",
        sa.Column(
            "visualizer_id",
            sa.Integer(),
            sa.ForeignKey("data.visualizers.id", ondelete="CASCADE"),
            nullable=True,
        ),
        schema="data",
    )
    op.create_index(
        "idx_imagery_sources_visualizer_id", "imagery_sources", ["visualizer_id"], schema="data"
    )
    op.create_check_constraint(
        "imagery_sources_one_owner_check",
        "imagery_sources",
        "(campaign_id IS NULL) <> (visualizer_id IS NULL)",
        schema="data",
    )

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

    op.drop_constraint("imagery_sources_one_owner_check", "imagery_sources", schema="data")
    op.drop_index("idx_imagery_sources_visualizer_id", "imagery_sources", schema="data")
    op.execute("DELETE FROM data.imagery_sources WHERE campaign_id IS NULL")
    op.drop_column("imagery_sources", "visualizer_id", schema="data")
    op.alter_column("imagery_sources", "campaign_id", nullable=False, schema="data")

    op.drop_column("visualizers", "registration_errors", schema="data")
    op.drop_column("visualizers", "registration_heartbeat_at", schema="data")
    op.drop_column("visualizers", "registration_status", schema="data")

    op.add_column("visualizers", sa.Column("center_lon", sa.Float(), nullable=True), schema="data")
    op.add_column("visualizers", sa.Column("center_lat", sa.Float(), nullable=True), schema="data")
    op.add_column("visualizers", sa.Column("zoom", sa.Float(), nullable=True), schema="data")

    op.drop_constraint("visualizers_bbox_all_or_none", "visualizers", schema="data")
    op.drop_constraint("visualizers_bbox_lat_order", "visualizers", schema="data")
    op.drop_constraint("visualizers_bbox_lon_order", "visualizers", schema="data")
    for column, _ in BOUNDS:
        op.drop_constraint(f"visualizers_{column}_range", "visualizers", schema="data")
        op.drop_column("visualizers", column, schema="data")
