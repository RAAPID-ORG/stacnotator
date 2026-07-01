"""add annotations_version counter to campaigns

A monotonic per-campaign counter bumped on every annotation create/update/
delete. The frontend appends it to annotation vector-tile URLs so an edit busts
the cache of the affected tiles without a manual purge.

Revision ID: t2annotver
Revises: t1annotgist
Create Date: 2026-06-29
"""

import sqlalchemy as sa
from alembic import op

revision = "t2annotver"
down_revision = "t1annotgist"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "campaigns",
        sa.Column("annotations_version", sa.Integer(), server_default="0", nullable=False),
        schema="data",
    )


def downgrade() -> None:
    op.drop_column("campaigns", "annotations_version", schema="data")
