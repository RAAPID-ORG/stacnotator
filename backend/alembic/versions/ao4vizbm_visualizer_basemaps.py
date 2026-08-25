"""let a visualizer own basemaps too

Basemaps get the same second owner imagery sources got in ao2vizown: a backdrop
belongs to exactly one of a campaign or a visualizer, so a visualizer can offer
the same configured backdrops a campaign does rather than a hardcoded one.

Revision ID: ao4vizbm
Revises: ao3vizfb
Create Date: 2026-08-23
"""

import sqlalchemy as sa

from alembic import op

revision = "ao4vizbm"
down_revision = "ao3vizfb"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Every existing basemap belongs to a campaign, so the check holds from the
    # moment it is added.
    op.alter_column("basemaps", "campaign_id", nullable=True, schema="data")
    op.add_column(
        "basemaps",
        sa.Column(
            "visualizer_id",
            sa.Integer(),
            sa.ForeignKey("data.visualizers.id", ondelete="CASCADE"),
            nullable=True,
        ),
        schema="data",
    )
    op.create_index("idx_basemaps_visualizer_id", "basemaps", ["visualizer_id"], schema="data")
    op.create_check_constraint(
        "basemaps_one_owner_check",
        "basemaps",
        "(campaign_id IS NULL) <> (visualizer_id IS NULL)",
        schema="data",
    )


def downgrade() -> None:
    op.drop_constraint("basemaps_one_owner_check", "basemaps", schema="data")
    op.drop_index("idx_basemaps_visualizer_id", "basemaps", schema="data")
    op.execute("DELETE FROM data.basemaps WHERE campaign_id IS NULL")
    op.drop_column("basemaps", "visualizer_id", schema="data")
    op.alter_column("basemaps", "campaign_id", nullable=False, schema="data")
