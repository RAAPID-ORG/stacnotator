"""add registration_status and embedding_status to campaigns

Revision ID: j1a2b3c4d5e6
Revises: i1a2b3c4d5e6
Create Date: 2026-04-03
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "j1a2b3c4d5e6"
down_revision = "i1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "campaigns",
        sa.Column("registration_status", sa.String(20), server_default="ready", nullable=False),
        schema="data",
    )
    op.add_column(
        "campaigns",
        sa.Column("embedding_status", sa.String(20), server_default="ready", nullable=False),
        schema="data",
    )
    op.add_column(
        "campaigns",
        sa.Column("registration_errors", postgresql.JSONB(), nullable=True),
        schema="data",
    )


def downgrade() -> None:
    op.drop_column("campaigns", "registration_errors", schema="data")
    op.drop_column("campaigns", "embedding_status", schema="data")
    op.drop_column("campaigns", "registration_status", schema="data")
