"""Custom index formulas on time series

Revision ID: avRcustomidx
Revises: avQannundo
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "avRcustomidx"
down_revision: str | Sequence[str] | None = "avQannundo"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("time_series", sa.Column("expression", sa.String()), schema="data")
    op.add_column("time_series", sa.Column("domain_min", sa.Float()), schema="data")
    op.add_column("time_series", sa.Column("domain_max", sa.Float()), schema="data")


def downgrade() -> None:
    # The previous release resolves every series through the built-in indices.
    custom = (
        op.get_bind()
        .execute(sa.text("SELECT count(*) FROM data.time_series WHERE expression IS NOT NULL"))
        .scalar_one()
    )
    if custom:
        raise RuntimeError(f"{custom} time series plot a custom index; remove them first")
    for column in ("expression", "domain_min", "domain_max"):
        op.drop_column("time_series", column, schema="data")
