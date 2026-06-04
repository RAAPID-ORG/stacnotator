"""add visitor role

Revision ID: d1f2a3b4c5e6
Revises: r1a2b3c4d5e6
Create Date: 2026-06-04 00:00:00.000000
"""

from alembic import op

revision = "d1f2a3b4c5e6"
down_revision = "r1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_constraint("user_roles_role_check", "user_roles", schema="auth", type_="check")
    op.create_check_constraint(
        "user_roles_role_check",
        "user_roles",
        "role IN ('user', 'approved', 'visitor', 'admin')",
        schema="auth",
    )


def downgrade() -> None:
    op.execute("DELETE FROM auth.user_roles WHERE role = 'visitor'")
    op.drop_constraint("user_roles_role_check", "user_roles", schema="auth", type_="check")
    op.create_check_constraint(
        "user_roles_role_check",
        "user_roles",
        "role IN ('user', 'approved', 'admin')",
        schema="auth",
    )
