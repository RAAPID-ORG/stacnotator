"""add encrypted_api_key to imagery_sources and basemaps

Stores AES-256-GCM ciphertext of provider API keys so the backend tile proxy can attach them
upstream. No value backfill is possible (old keys lived only in users' browsers); campaign
admins must re-enter each key once after deploy.

Revision ID: q5apikeyenc
Revises: p4dropvizfk
Create Date: 2026-06-24 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "q5apikeyenc"
down_revision: str | Sequence[str] | None = "p4dropvizfk"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "imagery_sources",
        sa.Column("encrypted_api_key", sa.Text(), nullable=True),
        schema="data",
    )
    op.add_column(
        "basemaps",
        sa.Column("encrypted_api_key", sa.Text(), nullable=True),
        schema="data",
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("basemaps", "encrypted_api_key", schema="data")
    op.drop_column("imagery_sources", "encrypted_api_key", schema="data")
