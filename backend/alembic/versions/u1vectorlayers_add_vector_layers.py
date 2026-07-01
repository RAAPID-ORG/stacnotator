"""add vector_layers table

Revision ID: u1vectorlayers
Revises: t1custommaps
Create Date: 2026-07-02 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "u1vectorlayers"
down_revision: str | Sequence[str] | None = "t1custommaps"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "vector_layers",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("campaign_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("pmtiles_url", sa.Text(), nullable=False),
        sa.Column("source_layer", sa.String(), nullable=True),
        sa.Column("color", sa.String(length=9), server_default="#3b82f6", nullable=False),
        sa.Column("display_order", sa.SmallInteger(), server_default="0", nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["campaign_id"], ["data.campaigns.id"], ondelete="CASCADE"),
        schema="data",
    )


def downgrade() -> None:
    op.drop_table("vector_layers", schema="data")
