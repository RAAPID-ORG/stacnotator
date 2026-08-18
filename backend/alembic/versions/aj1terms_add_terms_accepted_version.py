"""record which terms version a user accepted

Null means the user has not accepted the terms in force, which is every existing
account: they are asked to accept on their next visit and cannot use the app
until they do.

Revision ID: aj1terms
Revises: ai1claimsplit
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "aj1terms"
down_revision: str | Sequence[str] | None = "ai1claimsplit"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("terms_accepted_version", sa.Text(), nullable=True),
        schema="auth",
    )


def downgrade() -> None:
    op.drop_column("users", "terms_accepted_version", schema="auth")
