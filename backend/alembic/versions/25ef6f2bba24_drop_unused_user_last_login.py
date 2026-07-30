"""Drop unused auth.users.last_login column.

The column was created with the initial schema and defaulted on every insert,
but nothing in the application ever wrote a real login timestamp to it - it
tracked "row created", not "last login". Dropping it as dead state.

Revision ID: 25ef6f2bba24
Revises: z5dbhygiene
Create Date: 2026-07-28 16:16:54.916964

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "25ef6f2bba24"
down_revision: str | Sequence[str] | None = "z5dbhygiene"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_column("users", "last_login", schema="auth")


def downgrade() -> None:
    op.add_column(
        "users",
        sa.Column(
            "last_login",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.func.current_timestamp(),
            nullable=False,
        ),
        schema="auth",
    )
