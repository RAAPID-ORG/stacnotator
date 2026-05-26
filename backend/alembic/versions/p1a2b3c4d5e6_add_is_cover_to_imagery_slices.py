"""add is_cover to imagery_slices

Revision ID: p1a2b3c4d5e6
Revises: o1a2b3c4d5e6
Create Date: 2026-05-26
"""

import sqlalchemy as sa

from alembic import op

revision = "p1a2b3c4d5e6"
down_revision = "o1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "imagery_slices",
        sa.Column("is_cover", sa.Boolean(), server_default="false", nullable=False),
        schema="data",
    )
    # Backfill: existing data marks "real" custom cover slices implicitly via
    # cover_viz_params on the collection's stac_config + display_order=0
    # (the wizard always inserts the custom cover slice at index 0).
    op.execute(
        """
        UPDATE data.imagery_slices SET is_cover = true
         WHERE id IN (
           SELECT s.id
             FROM data.imagery_slices s
             JOIN data.imagery_collections c ON c.id = s.collection_id
             JOIN data.collection_stac_configs sc ON sc.collection_id = c.id
            WHERE s.display_order = 0
              AND sc.cover_viz_params IS NOT NULL
         )
        """
    )
    # Older wizard versions hard-coded the cover slice name to the literal
    # string "Cover". That leaked into picker labels post-refactor. Reset
    # those to empty so the UI falls back to the slice's date range.
    op.execute("UPDATE data.imagery_slices SET name = '' WHERE is_cover = true AND name = 'Cover'")


def downgrade() -> None:
    op.drop_column("imagery_slices", "is_cover", schema="data")
