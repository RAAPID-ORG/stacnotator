"""Hosted mosaics are registered again, stamped with their owner and layer

The tiler used to authorize a search by the campaign stamped on it, so a
visualizer's token had to name the whole campaign of every source it linked.
Searches now carry their owner and their layer, and a visualizer's token names
only the layers it links. Every search a hosted tiler holds was stamped the old
way, which the tiler no longer serves, so their mosaics are dropped here and the
owners left "pending": the first worker to boot claims each and registers what
is missing. MPC mosaics are not authorized by us and stay.

Revision ID: avIlayers
Revises: avHnomode
Create Date: 2026-10-24
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "avIlayers"
down_revision: str | Sequence[str] | None = "avHnomode"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    for owner in ("campaign", "visualizer"):
        op.execute(
            sa.text(
                f"UPDATE data.{owner}s SET registration_status = 'pending' "  # noqa: S608
                f"WHERE id IN ("
                f"  SELECT src.{owner}_id FROM data.slice_mosaics m"
                "   JOIN data.imagery_slices sl ON sl.id = m.slice_id"
                "   JOIN data.imagery_collections c ON c.id = sl.collection_id"
                "   JOIN data.imagery_sources src ON src.id = c.source_id"
                "   WHERE m.provider <> 'mpc')"
            )
        )
    op.execute("DELETE FROM data.slice_mosaics WHERE provider <> 'mpc'")
    op.execute(
        "UPDATE data.custom_maps "
        "SET mosaic_id = NULL, tile_url = NULL, status = 'pending', status_errors = NULL "
        "WHERE mosaic_id IS NOT NULL"
    )


def downgrade() -> None:
    """Nothing to restore: the dropped searches still exist on the tiler only until
    its cleanup runs, and whatever was registered under the new keys is simply
    registered again the old way the next time the imagery is saved."""
