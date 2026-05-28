"""replace is_cover with has_dedicated_cover

Revision ID: q1a2b3c4d5e6
Revises: p1a2b3c4d5e6
Create Date: 2026-05-28
"""

import sqlalchemy as sa

from alembic import op

revision = "q1a2b3c4d5e6"
down_revision = "p1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "imagery_collections",
        sa.Column("has_dedicated_cover", sa.Boolean(), server_default="false", nullable=False),
        schema="data",
    )
    op.execute(
        """
        UPDATE data.imagery_collections c
           SET has_dedicated_cover = TRUE
         WHERE EXISTS (
             SELECT 1 FROM data.imagery_slices s
              WHERE s.collection_id = c.id AND s.is_cover = TRUE)
        """
    )
    op.drop_column("imagery_slices", "is_cover", schema="data")
    # Repair collections where cover_viz_params / cover_search_query were left
    # dangling after a dedicated cover was deleted in the editor.
    op.execute(
        """
        UPDATE data.collection_stac_configs cfg
           SET cover_viz_params = NULL,
               cover_search_query = NULL
         WHERE NOT EXISTS (
             SELECT 1 FROM data.imagery_collections c
              WHERE c.id = cfg.collection_id AND c.has_dedicated_cover = TRUE)
        """
    )


def downgrade() -> None:
    op.add_column(
        "imagery_slices",
        sa.Column("is_cover", sa.Boolean(), server_default="false", nullable=False),
        schema="data",
    )
    op.execute(
        """
        UPDATE data.imagery_slices s
           SET is_cover = TRUE
         WHERE s.display_order = (
             SELECT c.cover_slice_index
               FROM data.imagery_collections c
              WHERE c.id = s.collection_id)
           AND EXISTS (
             SELECT 1 FROM data.imagery_collections c
              WHERE c.id = s.collection_id AND c.has_dedicated_cover = TRUE)
        """
    )
    op.drop_column("imagery_collections", "has_dedicated_cover", schema="data")
