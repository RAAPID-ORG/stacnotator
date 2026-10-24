"""A custom map's tile URL is derived from its search, like a slice's

custom_maps.tile_url baked the tiler's public URL and the render config in at
registration, so a colour edit had to restamp it and a change of tiler URL left
it stale. The map now stores which tiler its search is registered on, and the URL
is built when read. avIlayers already sent every registered map back to be
registered again, so no row holds a search to carry over.

Revision ID: avNcmtiler
Revises: avMagents
Create Date: 2026-10-24
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "avNcmtiler"
down_revision: str | Sequence[str] | None = "avMagents"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("custom_maps", sa.Column("tiler", sa.String(64), nullable=True), schema="data")
    op.drop_column("custom_maps", "tile_url", schema="data")


def downgrade() -> None:
    op.add_column("custom_maps", sa.Column("tile_url", sa.Text(), nullable=True), schema="data")
    op.drop_column("custom_maps", "tiler", schema="data")
