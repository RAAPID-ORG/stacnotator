"""composite GIST(mosaic_id, geom) on mosaic_items for fast tile lookups

Tile requests filter by `mosaic_id = X AND ST_Intersects(geom, tile)`. With
two separate indexes the planner picks one and re-checks the other in memory,
which is slow for high-cardinality mosaics. A composite GIST scopes the
spatial search to a single mosaic up front. Requires the btree_gist extension
to mix btree-style equality on mosaic_id with the GIST geometry column.

Revision ID: l1a2b3c4d5e6
Revises: k1a2b3c4d5e6
Create Date: 2026-04-30
"""

from alembic import op

revision = "l1a2b3c4d5e6"
down_revision = "k1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS btree_gist")
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_mosaic_items_mosaic_geom "
        "ON data.mosaic_items USING GIST (mosaic_id, geom)"
    )
    op.execute("ANALYZE data.mosaic_items")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS data.ix_mosaic_items_mosaic_geom")
