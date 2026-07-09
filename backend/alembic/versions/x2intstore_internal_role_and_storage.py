"""internal role + internal_storage flags (custom maps, imagery collections)

Revision ID: x2intstore
Revises: w1uniqname
Create Date: 2026-07-07 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "x2intstore"
down_revision: str | Sequence[str] | None = "w1uniqname"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_OLD_ROLES = "role IN ('user', 'approved', 'visitor', 'admin')"
_NEW_ROLES = "role IN ('user', 'approved', 'visitor', 'admin', 'internal')"
_STORAGE_TABLES = ("custom_maps", "collection_stac_configs")


def _swap_role_check(expr: str) -> None:
    op.drop_constraint("user_roles_role_check", "user_roles", schema="auth")
    op.create_check_constraint("user_roles_role_check", "user_roles", expr, schema="auth")


def upgrade() -> None:
    _swap_role_check(_NEW_ROLES)
    for table in _STORAGE_TABLES:
        op.add_column(
            table,
            sa.Column("internal_storage", sa.Boolean(), server_default=sa.false(), nullable=False),
            schema="data",
        )


def downgrade() -> None:
    for table in _STORAGE_TABLES:
        op.drop_column(table, "internal_storage", schema="data")
    # Drop any rows the old constraint would reject before re-tightening it.
    op.execute("DELETE FROM auth.user_roles WHERE role = 'internal'")
    _swap_role_check(_OLD_ROLES)
