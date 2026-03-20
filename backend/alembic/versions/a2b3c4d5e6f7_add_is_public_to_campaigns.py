"""add is_public to campaigns

Revision ID: a2b3c4d5e6f7
Revises: e1f2a3b4c5d6
Create Date: 2026-03-19

"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "a2b3c4d5e6f7"
down_revision = "e1f2a3b4c5d6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "campaigns",
        sa.Column("is_public", sa.Boolean(), server_default="false", nullable=False),
        schema="data",
    )


def downgrade() -> None:
    op.drop_column("campaigns", "is_public", schema="data")
