"""Encrypted private-storage access for custom COG maps.

Revision ID: at1mapaccess
Revises: as1origintask
Create Date: 2026-10-13
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "at1mapaccess"
down_revision: str | Sequence[str] | None = "as1origintask"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "custom_maps", sa.Column("storage_auth", sa.String(32), nullable=True), schema="data"
    )
    op.add_column(
        "custom_maps",
        sa.Column("encrypted_storage_secret", sa.Text(), nullable=True),
        schema="data",
    )
    op.add_column(
        "custom_maps",
        sa.Column("storage_secret_expires_at", sa.DateTime(timezone=True), nullable=True),
        schema="data",
    )


def downgrade() -> None:
    op.drop_column("custom_maps", "storage_secret_expires_at", schema="data")
    op.drop_column("custom_maps", "encrypted_storage_secret", schema="data")
    op.drop_column("custom_maps", "storage_auth", schema="data")
