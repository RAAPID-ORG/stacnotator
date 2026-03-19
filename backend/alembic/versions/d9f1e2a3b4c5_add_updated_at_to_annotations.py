"""Add updated_at column to annotations table

Revision ID: d9f1e2a3b4c5
Revises: c8d9e0f1a2b3
Create Date: 2026-03-18 12:00:00.000000

"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "d9f1e2a3b4c5"
down_revision: str | None = "c8d9e0f1a2b3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SCHEMA = "data"


def upgrade() -> None:
    op.add_column(
        "annotations",
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        schema=SCHEMA,
    )

    # Backfill: set updated_at = created_at for all existing annotations
    conn = op.get_bind()
    conn.execute(
        sa.text(f"UPDATE {SCHEMA}.annotations SET updated_at = created_at WHERE updated_at IS NULL OR updated_at = now()")
    )


def downgrade() -> None:
    op.drop_column("annotations", "updated_at", schema=SCHEMA)
