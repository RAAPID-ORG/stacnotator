"""Heartbeat stamps for campaign background runs.

Background mosaic registration and embedding computation run on daemon threads
inside disposable web workers. These timestamps let the app tell a live run
from one whose worker died, so stuck "registering" statuses can be swept to
"failed" instead of blocking the campaign forever.

Revision ID: ab1heartbeat
Revises: aa8rendfix
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "ab1heartbeat"
down_revision: str | Sequence[str] | None = "aa8rendfix"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "campaigns",
        sa.Column("registration_heartbeat_at", sa.TIMESTAMP(timezone=True), nullable=True),
        schema="data",
    )
    op.add_column(
        "campaigns",
        sa.Column("embedding_heartbeat_at", sa.TIMESTAMP(timezone=True), nullable=True),
        schema="data",
    )


def downgrade() -> None:
    op.drop_column("campaigns", "embedding_heartbeat_at", schema="data")
    op.drop_column("campaigns", "registration_heartbeat_at", schema="data")
