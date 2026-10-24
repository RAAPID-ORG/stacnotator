"""A collection's cloud-cover ceiling lives only in its search query

imagery_collections.max_cloud_cover repeated the eo:cloud_cover filter the
search query carries, and the hosted tiler's ingest was capped by the column
while the search filtered by the query, so the two could disagree and the
ingest drop items the search wanted. Every STAC collection has a query, and
registration now reads the ceiling from it.

Revision ID: avKcloud
Revises: avJinvites
Create Date: 2026-10-24
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "avKcloud"
down_revision: str | Sequence[str] | None = "avJinvites"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_column("imagery_collections", "max_cloud_cover", schema="data")


def downgrade() -> None:
    op.add_column(
        "imagery_collections",
        sa.Column("max_cloud_cover", sa.Float(), nullable=True),
        schema="data",
    )
