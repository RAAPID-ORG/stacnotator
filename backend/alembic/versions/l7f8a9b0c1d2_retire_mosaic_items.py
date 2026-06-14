"""retire mosaic_items / mosaic_registrations (converged titiler-pgstac tiler)

The self-hosted mosaic_items tiler is retired: items now live in the tiler's own pgstac.
Drop the materialization tables and the slice_tile_urls FK; slice_tile_urls.mosaic_id is now
a plain provider reference (search id), and tile_provider holds "mpc" or a tiler name.

Revision ID: l7f8a9b0c1d2
Revises: k6e7f8a9b0c1
Create Date: 2026-06-13 00:00:00.000000

"""

from collections.abc import Sequence

import geoalchemy2
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "l7f8a9b0c1d2"
down_revision: str | Sequence[str] | None = "k6e7f8a9b0c1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Drop the mosaic materialization tables and the slice_tile_urls FK."""
    op.drop_constraint(
        "slice_tile_urls_mosaic_id_fkey",
        "slice_tile_urls",
        schema="data",
        type_="foreignkey",
    )
    op.alter_column(
        "slice_tile_urls",
        "tile_provider",
        type_=sa.String(length=64),
        schema="data",
        existing_type=sa.String(length=20),
        existing_nullable=True,
    )
    op.drop_table("mosaic_items", schema="data")
    op.drop_table("mosaic_registrations", schema="data")


def downgrade() -> None:
    """Recreate the mosaic tables + FK (structure only; data is not restored)."""
    op.create_table(
        "mosaic_registrations",
        sa.Column("mosaic_id", sa.String(length=64), primary_key=True),
        sa.Column("catalog_url", sa.Text(), nullable=False),
        sa.Column("stac_collection_id", sa.String(), nullable=False),
        sa.Column("bbox", JSONB(), nullable=False),
        sa.Column("datetime_range", sa.String(), nullable=False),
        sa.Column("max_cloud_cover", sa.Float(), nullable=True),
        sa.Column("item_count", sa.Integer(), server_default="0", nullable=False),
        sa.Column("assets_info", JSONB(), nullable=True),
        sa.Column("status", sa.String(length=20), server_default="pending", nullable=False),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("registered_at", sa.DateTime(), server_default=sa.func.now()),
        schema="data",
    )
    op.create_table(
        "mosaic_items",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "mosaic_id",
            sa.String(length=64),
            sa.ForeignKey("data.mosaic_registrations.mosaic_id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("item_id", sa.String(), nullable=False),
        sa.Column("href", sa.Text(), nullable=False),
        sa.Column("bbox_west", sa.Float(), nullable=False),
        sa.Column("bbox_south", sa.Float(), nullable=False),
        sa.Column("bbox_east", sa.Float(), nullable=False),
        sa.Column("bbox_north", sa.Float(), nullable=False),
        sa.Column("datetime", sa.String(), nullable=False),
        sa.Column("cloud_cover", sa.Float(), nullable=True),
        sa.Column("geom", geoalchemy2.Geometry("POLYGON", srid=4326), nullable=True),
        sa.Column("stac_item", JSONB(), nullable=True),
        schema="data",
    )
    op.alter_column(
        "slice_tile_urls",
        "tile_provider",
        type_=sa.String(length=20),
        schema="data",
        existing_type=sa.String(length=64),
        existing_nullable=True,
    )
    op.create_foreign_key(
        "slice_tile_urls_mosaic_id_fkey",
        "slice_tile_urls",
        "mosaic_registrations",
        ["mosaic_id"],
        ["mosaic_id"],
        source_schema="data",
        referent_schema="data",
        ondelete="SET NULL",
    )
