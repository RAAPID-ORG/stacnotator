"""STAC slices left without a search register again

Before avDmosaics was corrected, it carried over only the searches a tile URL row
named in its own columns. Rows written while ``mosaic_id`` still referenced the
local mosaic table held an MPC search id only in their URL, so those slices came
out with no search, and their owners stayed "ready" with nothing to draw. Any owner
with such a slice is left "pending", so the first worker to boot registers what is
missing; a database migrated with the corrected avDmosaics has none.

Revision ID: avOresync
Revises: avNcmtiler
Create Date: 2026-10-25
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "avOresync"
down_revision: str | Sequence[str] | None = "avNcmtiler"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    for owner in ("campaign", "visualizer"):
        op.execute(
            sa.text(
                f"UPDATE data.{owner}s SET registration_status = 'pending' "  # noqa: S608
                "WHERE registration_status = 'ready' AND id IN ("
                f"  SELECT src.{owner}_id FROM data.imagery_slices sl"
                "   JOIN data.imagery_collections c ON c.id = sl.collection_id"
                "   JOIN data.imagery_sources src ON src.id = c.source_id"
                "   WHERE c.catalog_url IS NOT NULL"
                "     AND EXISTS (SELECT 1 FROM data.collection_visualizations cv"
                "                 WHERE cv.collection_id = c.id)"
                "     AND NOT EXISTS (SELECT 1 FROM data.slice_mosaics m"
                "                     WHERE m.slice_id = sl.id))"
            )
        )


def downgrade() -> None:
    """Nothing to undo: registering a missing search changes no stored setting."""
