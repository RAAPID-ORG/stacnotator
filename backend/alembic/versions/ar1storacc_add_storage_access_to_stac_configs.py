"""A private STAC catalog's own storage access (an Azure SAS token today).

Revision ID: ar1storacc
Revises: aq1agents
Create Date: 2026-10-05 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "ar1storacc"
down_revision: str | Sequence[str] | None = "aq1agents"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "collection_stac_configs",
        sa.Column("storage_auth", sa.String(length=32), nullable=True),
        schema="data",
    )
    op.add_column(
        "collection_stac_configs",
        sa.Column("encrypted_storage_secret", sa.Text(), nullable=True),
        schema="data",
    )
    op.add_column(
        "collection_stac_configs",
        sa.Column("storage_secret_expires_at", sa.TIMESTAMP(timezone=True), nullable=True),
        schema="data",
    )


def downgrade() -> None:
    op.drop_column("collection_stac_configs", "storage_secret_expires_at", schema="data")
    op.drop_column("collection_stac_configs", "encrypted_storage_secret", schema="data")
    op.drop_column("collection_stac_configs", "storage_auth", schema="data")
