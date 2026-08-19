"""let a campaign publish its annotations as open research data

Off for every existing campaign: publication only ever starts from a campaign
admin turning it on.

Revision ID: ak1research
Revises: aj1terms
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "ak1research"
down_revision: str | Sequence[str] | None = "aj1terms"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "settings",
        sa.Column(
            "research_sharing",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
        schema="data",
    )


def downgrade() -> None:
    op.drop_column("settings", "research_sharing", schema="data")
