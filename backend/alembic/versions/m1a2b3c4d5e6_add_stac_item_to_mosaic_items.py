"""add stac_item JSONB to mosaic_items

Schema-only. Existing rows are left NULL and the tiler falls back to its
legacy HTTP-fetch path. Backfill is performed out-of-band by
backend/scripts/backfill_stac_item.py so it can be throttled, resumed, and
re-run without blocking a deploy.

Revision ID: m1a2b3c4d5e6
Revises: l1a2b3c4d5e6
Create Date: 2026-04-30
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "m1a2b3c4d5e6"
down_revision = "l1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "mosaic_items",
        sa.Column("stac_item", JSONB(), nullable=True),
        schema="data",
    )


def downgrade() -> None:
    op.drop_column("mosaic_items", "stac_item", schema="data")
