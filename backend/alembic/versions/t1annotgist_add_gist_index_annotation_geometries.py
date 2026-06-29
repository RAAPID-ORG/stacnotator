"""add GiST index on annotation_geometries.geometry for vector-tile lookups

The annotation vector-tile endpoint filters geometries by tile envelope
(``geometry && ST_Transform(envelope, 4326)``). Without a spatial index that is
a sequential scan over every geometry in the table. This adds the GiST index
that scan relies on.

Built CONCURRENTLY (outside the migration transaction) because the table may be
large in production and a plain CREATE INDEX would hold a write lock for the
duration. CONCURRENTLY cannot run inside a transaction, hence the autocommit
block.

Revision ID: t1annotgist
Revises: q5apikeyenc
Create Date: 2026-06-29
"""

from alembic import op

revision = "t1annotgist"
down_revision = "q5apikeyenc"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.get_context().autocommit_block():
        op.execute(
            "CREATE INDEX CONCURRENTLY IF NOT EXISTS "
            "ix_annotation_geometries_geom "
            "ON data.annotation_geometries USING GIST (geometry)"
        )


def downgrade() -> None:
    with op.get_context().autocommit_block():
        op.execute("DROP INDEX CONCURRENTLY IF EXISTS data.ix_annotation_geometries_geom")
