"""unified tiler model: per-collection tiler + per-user allowed-tiler set

One migration for the whole tiler feature:
 1. widen data.collection_stac_configs.tile_provider 20 -> 64 (holds a hosted tiler name)
 2. create auth.user_tilers (a user's full allowed-tiler set)
 3. seed the default tilers (MPC + DEFAULT_TILER, from env) for existing users; new users are
    seeded at registration

Revision ID: m8a9b0c1d2e3
Revises: l7f8a9b0c1d2
Create Date: 2026-06-18 00:00:00.000000

"""

import os
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "m8a9b0c1d2e3"
down_revision: str | Sequence[str] | None = "l7f8a9b0c1d2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _default_tiler_names() -> list[str]:
    names = ["mpc"]
    default_hosted = os.environ.get("DEFAULT_TILER")
    if default_hosted:
        names.append(default_hosted)
    return names


def upgrade() -> None:
    op.alter_column(
        "collection_stac_configs",
        "tile_provider",
        type_=sa.String(length=64),
        existing_type=sa.String(length=20),
        existing_nullable=True,
        schema="data",
    )

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

    conn = op.get_bind()
    for name in _default_tiler_names():
        conn.execute(
            sa.text(
                "INSERT INTO auth.user_tilers (user_id, tiler_name) "
                "SELECT id, :name FROM auth.users ON CONFLICT DO NOTHING"
            ),
            {"name": name},
        )


def downgrade() -> None:
    op.drop_index("user_tilers_user_id_idx", table_name="user_tilers", schema="auth")
    op.drop_table("user_tilers", schema="auth")
    op.alter_column(
        "collection_stac_configs",
        "tile_provider",
        type_=sa.String(length=20),
        existing_type=sa.String(length=64),
        existing_nullable=True,
        schema="data",
    )
