"""A campaign no longer stores which work mode its page opens in

campaigns.default_work_mode was left from the time a campaign was either open or
task-based. The labelling policy decides who may explore and who may answer
tasks, and nothing set the column any more, so the page now opens in Tasks when
there are tasks the viewer may work and in Explore otherwise.

Revision ID: avHnomode
Revises: avGtasks
Create Date: 2026-10-24
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "avHnomode"
down_revision: str | Sequence[str] | None = "avGtasks"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_constraint("campaigns_default_work_mode_values", "campaigns", schema="data")
    op.drop_column("campaigns", "default_work_mode", schema="data")


def downgrade() -> None:
    op.add_column(
        "campaigns",
        sa.Column("default_work_mode", sa.String(20), server_default="tasks", nullable=False),
        schema="data",
    )
    op.alter_column("campaigns", "default_work_mode", server_default=None, schema="data")
    op.create_check_constraint(
        "campaigns_default_work_mode_values",
        "campaigns",
        "default_work_mode IN ('tasks', 'explore')",
        schema="data",
    )
