"""A visualizer's custom map names are unique, as a campaign's are

The service checked it and the database did not. The plain index on
custom_maps.visualizer_id goes: the unique constraint leading with it covers it.

Revision ID: avLtidy
Revises: avJinvites
Create Date: 2026-10-24
"""

from collections.abc import Sequence

from alembic import op

revision: str = "avLtidy"
down_revision: str | Sequence[str] | None = "avJinvites"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
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
