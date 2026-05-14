"""add max_native_zoom to basemaps

Revision ID: o1a2b3c4d5e6
Revises: n1a2b3c4d5e6
Create Date: 2026-05-14
"""

import sqlalchemy as sa

from alembic import op

revision = "o1a2b3c4d5e6"
down_revision = "n1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "basemaps",
        sa.Column("max_native_zoom", sa.SmallInteger(), nullable=True),
        schema="data",
    )
    # Backfill existing basemaps for well-known providers so users on existing
    # campaigns don't see "no data" placeholders when zooming past the
    # provider's coverage. Custom URLs stay NULL (= unlimited).
    # Esri uses 18 (not the docs' "19 worldwide") because rural areas
    # (e.g. Ukrainian/African cropland) only have real imagery up to z18
    # and return a placeholder PNG at z19+.
    op.execute(
        """
        UPDATE data.basemaps
           SET max_native_zoom = CASE
             WHEN url ILIKE '%arcgisonline%' OR url ILIKE '%esri%'   THEN 18
             WHEN url ILIKE '%opentopomap%'                          THEN 17
             WHEN url ILIKE '%cartocdn%'    OR url ILIKE '%carto%'   THEN 20
             WHEN url ILIKE '%openstreetmap%'                        THEN 19
           END
         WHERE max_native_zoom IS NULL
           AND (
                url ILIKE '%arcgisonline%' OR url ILIKE '%esri%'
             OR url ILIKE '%opentopomap%'
             OR url ILIKE '%cartocdn%'    OR url ILIKE '%carto%'
             OR url ILIKE '%openstreetmap%'
           )
        """
    )


def downgrade() -> None:
    op.drop_column("basemaps", "max_native_zoom", schema="data")
