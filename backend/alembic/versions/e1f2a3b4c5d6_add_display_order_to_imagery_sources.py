"""Add display_order to imagery_sources

Revision ID: e1f2a3b4c5d6
Revises: d9f1e2a3b4c5
Create Date: 2026-03-18 14:00:00.000000

"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "e1f2a3b4c5d6"
down_revision: str | None = "d9f1e2a3b4c5"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "imagery_sources",
        sa.Column("display_order", sa.SmallInteger(), server_default="0", nullable=False),
        schema="data",
    )

    # Back-fill existing sources: assign display_order by id ascending per campaign
    op.execute(
        sa.text("""
            UPDATE data.imagery_sources s
            SET display_order = sub.rn
            FROM (
                SELECT id, ROW_NUMBER() OVER (PARTITION BY campaign_id ORDER BY id) - 1 AS rn
                FROM data.imagery_sources
            ) sub
            WHERE s.id = sub.id
        """)
    )


def downgrade() -> None:
    op.drop_column("imagery_sources", "display_order", schema="data")
