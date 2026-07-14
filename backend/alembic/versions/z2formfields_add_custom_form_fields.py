"""Add custom form fields to settings and form values to annotations.

Revision ID: z2formfields
Revises: z1labelpolicy
Create Date: 2026-07-14 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "z2formfields"
down_revision: str | Sequence[str] | None = "z1labelpolicy"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "settings",
        sa.Column("form_fields", postgresql.JSONB(), nullable=True),
        schema="data",
    )
    op.execute("UPDATE data.settings SET form_fields = '[]'::jsonb")
    op.alter_column(
        "settings",
        "form_fields",
        nullable=False,
        server_default=sa.text("'[]'::jsonb"),
        schema="data",
    )
    op.add_column(
        "annotations",
        sa.Column("form_values", postgresql.JSONB(), nullable=True),
        schema="data",
    )


def downgrade() -> None:
    op.drop_column("annotations", "form_values", schema="data")
    op.drop_column("settings", "form_fields", schema="data")
