"""Small schema corrections

- timeseries_windows.display_order: nothing read it; windows are placed by
  canvas layouts.
- canvas_layouts.layout_data defaulted to '{}' in the database while it holds a
  list and the model said '[]'.
- custom_maps: a visualizer's map names are unique as a campaign's are, which
  the service checked and the database did not.
- Indexes on campaign_id / visualizer_id that a unique constraint leading with
  the same column already provides.

Revision ID: avLtidy
Revises: avKcloud
Create Date: 2026-10-24
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "avLtidy"
down_revision: str | Sequence[str] | None = "avKcloud"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_column("timeseries_windows", "display_order", schema="data")
    op.drop_index(
        "idx_timeseries_windows_campaign_id", table_name="timeseries_windows", schema="data"
    )
    op.alter_column(
        "canvas_layouts", "layout_data", server_default=sa.text("'[]'::jsonb"), schema="data"
    )
    # Two maps of one visualizer sharing a name keep it apart by their id.
    op.execute(
        """
        UPDATE data.custom_maps cm SET name = cm.name || ' (' || cm.id || ')'
        WHERE cm.visualizer_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM data.custom_maps o
            WHERE o.visualizer_id = cm.visualizer_id AND o.name = cm.name AND o.id < cm.id
        )
        """
    )
    op.create_unique_constraint(
        "uq_custom_maps_visualizer_name",
        "custom_maps",
        ["visualizer_id", "name"],
        schema="data",
    )
    op.drop_index("idx_custom_maps_visualizer_id", table_name="custom_maps", schema="data")


def downgrade() -> None:
    op.create_index(
        "idx_custom_maps_visualizer_id", "custom_maps", ["visualizer_id"], schema="data"
    )
    op.drop_constraint(
        "uq_custom_maps_visualizer_name", "custom_maps", type_="unique", schema="data"
    )
    op.alter_column(
        "canvas_layouts", "layout_data", server_default=sa.text("'{}'::jsonb"), schema="data"
    )
    op.create_index(
        "idx_timeseries_windows_campaign_id", "timeseries_windows", ["campaign_id"], schema="data"
    )
    op.add_column(
        "timeseries_windows",
        sa.Column("display_order", sa.SmallInteger(), server_default="0", nullable=False),
        schema="data",
    )
