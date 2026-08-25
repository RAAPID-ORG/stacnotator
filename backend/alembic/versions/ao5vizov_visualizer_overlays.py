"""let a visualizer own overlays too

The last of the four layer tables to get a second owner. A custom map or a
vector layer now belongs to exactly one of a campaign or a visualizer, so a
visualizer can set up predictions and reference layers of its own rather than
only reusing a campaign's.

The overlay list itself (data.visualizer_overlays) is unchanged: an overlay set
up here joins it when it is created, exactly as a linked one does when it is
ticked, so the viewer and feedback still have one list to point at.

Revision ID: ao5vizov
Revises: ao4vizbm
Create Date: 2026-08-23
"""

import sqlalchemy as sa

from alembic import op

revision = "ao5vizov"
down_revision = "ao4vizbm"
branch_labels = None
depends_on = None

TABLES = ("custom_maps", "vector_layers")


def upgrade() -> None:
    for table in TABLES:
        # Every existing overlay belongs to a campaign, so the check holds from
        # the moment it is added.
        op.alter_column(table, "campaign_id", nullable=True, schema="data")
        op.add_column(
            table,
            sa.Column(
                "visualizer_id",
                sa.Integer(),
                sa.ForeignKey("data.visualizers.id", ondelete="CASCADE"),
                nullable=True,
            ),
            schema="data",
        )
        op.create_index(f"idx_{table}_visualizer_id", table, ["visualizer_id"], schema="data")
        op.create_check_constraint(
            f"{table}_one_owner_check",
            table,
            "(campaign_id IS NULL) <> (visualizer_id IS NULL)",
            schema="data",
        )


def downgrade() -> None:
    # Written out rather than looped: the DELETE cannot take a bound table name,
    # and a literal is easier to read than a formatted one.
    op.drop_constraint("custom_maps_one_owner_check", "custom_maps", schema="data")
    op.drop_index("idx_custom_maps_visualizer_id", "custom_maps", schema="data")
    op.execute("DELETE FROM data.custom_maps WHERE campaign_id IS NULL")
    op.drop_column("custom_maps", "visualizer_id", schema="data")
    op.alter_column("custom_maps", "campaign_id", nullable=False, schema="data")

    op.drop_constraint("vector_layers_one_owner_check", "vector_layers", schema="data")
    op.drop_index("idx_vector_layers_visualizer_id", "vector_layers", schema="data")
    op.execute("DELETE FROM data.vector_layers WHERE campaign_id IS NULL")
    op.drop_column("vector_layers", "visualizer_id", schema="data")
    op.alter_column("vector_layers", "campaign_id", nullable=False, schema="data")
