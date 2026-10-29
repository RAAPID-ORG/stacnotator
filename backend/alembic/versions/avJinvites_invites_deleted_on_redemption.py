"""An invite is deleted when it is redeemed

An invite exists only until the person signs up, when it becomes their
membership. Redeemed rows were kept with consumed_at and consumed_by, which
nothing read, so every query had to filter them out. Redemption now deletes the
row; the stored redeemed invites go with their two columns.

Revision ID: avJinvites
Revises: avIlayers
Create Date: 2026-10-24
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "avJinvites"
down_revision: str | Sequence[str] | None = "avIlayers"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TARGET = ["email", sa.text("COALESCE(organization_id, 0)"), sa.text("COALESCE(project_id, 0)")]


def upgrade() -> None:
    op.execute("DELETE FROM data.invites WHERE consumed_at IS NOT NULL")
    op.drop_index("invites_pending_target_uniq", table_name="invites", schema="data")
    op.create_index("invites_target_uniq", "invites", _TARGET, unique=True, schema="data")
    op.drop_column("invites", "consumed_by", schema="data")
    op.drop_column("invites", "consumed_at", schema="data")


def downgrade() -> None:
    op.add_column(
        "invites",
        sa.Column("consumed_at", postgresql.TIMESTAMP(timezone=True), nullable=True),
        schema="data",
    )
    op.add_column("invites", sa.Column("consumed_by", sa.Uuid(), nullable=True), schema="data")
    op.drop_index("invites_target_uniq", table_name="invites", schema="data")
    op.create_index(
        "invites_pending_target_uniq",
        "invites",
        _TARGET,
        unique=True,
        schema="data",
        postgresql_where=sa.text("consumed_at IS NULL"),
    )
