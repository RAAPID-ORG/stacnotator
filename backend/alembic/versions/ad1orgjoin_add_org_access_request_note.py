"""Add the note a user writes when requesting access to an organization.

Revision ID: ad1orgjoin
Revises: ac1imggen
Create Date: 2026-08-14 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "ad1orgjoin"
down_revision: str | Sequence[str] | None = "ac1imggen"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "organization_users",
        sa.Column("request_note", sa.Text(), nullable=True),
        schema="data",
    )


def downgrade() -> None:
    op.drop_column("organization_users", "request_note", schema="data")
