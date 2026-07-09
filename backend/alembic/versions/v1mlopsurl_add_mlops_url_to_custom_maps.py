"""add mlops_url to custom_maps

Revision ID: v1mlopsurl
Revises: u1vectorlayers
Create Date: 2026-07-02 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "v1mlopsurl"
down_revision: str | Sequence[str] | None = "u1vectorlayers"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "custom_maps",
        sa.Column("mlops_url", sa.Text(), nullable=True),
        schema="data",
    )


def downgrade() -> None:
    op.drop_column("custom_maps", "mlops_url", schema="data")
