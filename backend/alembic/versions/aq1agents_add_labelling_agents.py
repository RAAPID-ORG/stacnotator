"""add labelling agents

Revision ID: aq1agents
Revises: ap1keyhost
Create Date: 2026-09-16 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "aq1agents"
down_revision: str | Sequence[str] | None = "ap1keyhost"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "labelling_agents",
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("owner_user_id", sa.Uuid(), nullable=False),
        sa.Column("campaign_id", sa.Integer(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("takes_over_work", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(["user_id"], ["auth.users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["owner_user_id"], ["auth.users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["campaign_id"], ["data.campaigns.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id"),
        schema="data",
    )
    op.create_index(
        "idx_labelling_agents_owner_campaign",
        "labelling_agents",
        ["owner_user_id", "campaign_id"],
        schema="data",
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table("labelling_agents", schema="data")
