"""add cloud_cover and geom to mosaic_items

Revision ID: i1a2b3c4d5e6
Revises: h1a2b3c4d5e6
Create Date: 2026-04-02
"""

from alembic import op
import sqlalchemy as sa

revision = "i1a2b3c4d5e6"
down_revision = "h1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "mosaic_items",
        sa.Column("cloud_cover", sa.Float(), nullable=True),
        schema="data",
    )
    # Add PostGIS geometry column for spatial indexing
    op.execute(
        "ALTER TABLE data.mosaic_items "
        "ADD COLUMN geom geometry(Polygon, 4326)"
    )
    # Backfill geom from existing bbox columns
    op.execute(
        """
        UPDATE data.mosaic_items SET geom = ST_MakeEnvelope(
            bbox_west, bbox_south, bbox_east, bbox_north, 4326
        ) WHERE geom IS NULL
        """
    )
    # Create GiST spatial index
    op.execute(
        "CREATE INDEX ix_mosaic_items_geom ON data.mosaic_items USING GIST (geom)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS data.ix_mosaic_items_geom")
    op.drop_column("mosaic_items", "geom", schema="data")
    op.drop_column("mosaic_items", "cloud_cover", schema="data")
