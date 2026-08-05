"""drop per-user tiler grants and the approved/visitor/internal roles

Organizations own these decisions now: membership replaces approval, the org
tiler allowlist (seeded in aa1orgs) replaces auth.user_tilers, and
organizations.allows_internal_storage replaces the internal role. Only 'user'
and 'admin' remain valid roles.

Downgrade restores the wider role constraint and an EMPTY user_tilers table:
the deleted role rows and per-user grants are not recoverable.

Revision ID: aa2roles
Revises: aa1orgs
Create Date: 2026-08-05 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "aa2roles"
down_revision: str | Sequence[str] | None = "aa1orgs"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_OLD_ROLES = "role IN ('user', 'approved', 'visitor', 'admin', 'internal')"
_NEW_ROLES = "role IN ('user', 'admin')"
_LEGACY_ROLES = "('approved', 'visitor', 'internal')"


def _swap_role_check(expr: str) -> None:
    op.drop_constraint("user_roles_role_check", "user_roles", schema="auth")
    op.create_check_constraint("user_roles_role_check", "user_roles", expr, schema="auth")


def upgrade() -> None:
    op.drop_index("user_tilers_user_id_idx", table_name="user_tilers", schema="auth")
    op.drop_table("user_tilers", schema="auth")
    op.execute(f"DELETE FROM auth.user_roles WHERE role IN {_LEGACY_ROLES}")
    _swap_role_check(_NEW_ROLES)


def downgrade() -> None:
    _swap_role_check(_OLD_ROLES)
    op.create_table(
        "user_tilers",
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("tiler_name", sa.String(length=64), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["auth.users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id", "tiler_name"),
        schema="auth",
    )
    op.create_index(
        "user_tilers_user_id_idx", "user_tilers", ["user_id"], unique=False, schema="auth"
    )
