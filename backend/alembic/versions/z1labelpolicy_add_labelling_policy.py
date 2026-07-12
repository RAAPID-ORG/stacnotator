"""add labelling_policy to settings

Adds the labelling-policy JSONB column that replaces the open/task mode
question with four audience-scoped permissions (explore, unassigned_tasks,
assigned_tasks, complete_assigned). Backfills existing campaigns with the
spec's default policy: members may explore/label unassigned/label assigned
tasks; assignees+admins+authoritative count toward completing an assigned
task. See docs/superpowers/specs/2026-07-12-labelling-policy-design.md.

Revision ID: z1labelpolicy
Revises: y1tasksets
Create Date: 2026-07-12 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "z1labelpolicy"
down_revision: str | Sequence[str] | None = "y1tasksets"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

DEFAULT_POLICY_JSON = (
    '{"explore": {"kinds": ["members"], "user_ids": []}, '
    '"unassigned_tasks": {"kinds": ["members"], "user_ids": []}, '
    '"assigned_tasks": {"kinds": ["members"], "user_ids": []}, '
    '"complete_assigned": {"kinds": ["assignees", "admins", "authoritative"], '
    '"user_ids": []}}'
)


def upgrade() -> None:
    op.add_column(
        "settings",
        sa.Column("labelling_policy", postgresql.JSONB(), nullable=True),
        schema="data",
    )
    op.execute(
        f"UPDATE data.settings SET labelling_policy = '{DEFAULT_POLICY_JSON}'::jsonb "
        "WHERE labelling_policy IS NULL"
    )
    op.alter_column(
        "settings",
        "labelling_policy",
        nullable=False,
        server_default=sa.text(f"'{DEFAULT_POLICY_JSON}'::jsonb"),
        schema="data",
    )


def downgrade() -> None:
    op.drop_column("settings", "labelling_policy", schema="data")
