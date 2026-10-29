"""Platform admin is a flag on the user, not a row in a roles table.

auth.user_roles only ever meant one thing: 'admin'. The 'user' role was granted
to the local user and never read. The flag replaces both.

Revision ID: av1platadmin
Revises: au1taskoutput
Create Date: 2026-10-23
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "av1platadmin"
down_revision: str | Sequence[str] | None = "au1taskoutput"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("is_platform_admin", sa.Boolean(), server_default=sa.false(), nullable=False),
        schema="auth",
    )
    op.execute(
        "UPDATE auth.users SET is_platform_admin = true "
        "WHERE id IN (SELECT user_id FROM auth.user_roles WHERE role = 'admin')"
    )
    op.drop_table("user_roles", schema="auth")


def downgrade() -> None:
    op.create_table(
        "user_roles",
        sa.Column(
            "user_id",
            sa.UUID(),
            sa.ForeignKey("auth.users.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("role", sa.Text(), primary_key=True),
        sa.CheckConstraint("role IN ('user', 'admin')", name="user_roles_role_check"),
        schema="auth",
    )
    op.create_index("user_roles_user_id_idx", "user_roles", ["user_id"], schema="auth")
    op.execute(
        "INSERT INTO auth.user_roles (user_id, role) "
        "SELECT id, 'admin' FROM auth.users WHERE is_platform_admin"
    )
    op.drop_column("users", "is_platform_admin", schema="auth")
