"""Every stored labelling policy names all five axes.

A policy missing an axis was read with that axis's default: no one for the four
labelling axes, campaign admins for modify_others (added after the others). The
defaults are written into the rows so the schema can require every axis.

Revision ID: av3policyaxes
Revises: av2workmode
Create Date: 2026-10-23
"""

from collections.abc import Sequence

from alembic import op

revision: str = "av3policyaxes"
down_revision: str | Sequence[str] | None = "av2workmode"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_DEFAULTS = {
    "explore": "[]",
    "unassigned_tasks": "[]",
    "assigned_tasks": "[]",
    "complete_assigned": "[]",
    "modify_others": '["admins"]',
}


def upgrade() -> None:
    for axis, kinds in _DEFAULTS.items():
        op.execute(
            f"""
            UPDATE data.settings
            SET labelling_policy = jsonb_set(
                labelling_policy, '{{{axis}}}', '{{"kinds": {kinds}, "user_ids": []}}'::jsonb
            )
            WHERE NOT labelling_policy ? '{axis}'
            """
        )


def downgrade() -> None:
    pass
