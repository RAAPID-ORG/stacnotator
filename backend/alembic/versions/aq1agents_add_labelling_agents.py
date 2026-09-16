"""add labelling agents and their render jobs

Revision ID: aq1agents
Revises: ap1keyhost
Create Date: 2026-09-16 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

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
        sa.Column("default_views", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("takes_over_work", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column("host_seen_at", sa.DateTime(timezone=True), nullable=True),
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
    op.create_table(
        "agent_render_jobs",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("agent_user_id", sa.Uuid(), nullable=False),
        sa.Column("task_id", sa.Integer(), nullable=False),
        sa.Column("view_key", sa.String(length=64), nullable=False),
        sa.Column("view", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("status", sa.String(length=16), server_default="pending", nullable=False),
        sa.Column("priority", sa.SmallInteger(), server_default="1", nullable=False),
        sa.Column("claimed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("image", sa.LargeBinary(), nullable=True),
        sa.Column("mime_type", sa.String(length=32), nullable=True),
        sa.Column("meta", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(
            ["agent_user_id"], ["data.labelling_agents.user_id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["task_id"], ["data.annotation_tasks.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("agent_user_id", "task_id", "view_key"),
        schema="data",
    )
    op.create_index(
        "idx_agent_render_jobs_pending",
        "agent_render_jobs",
        ["status", "priority", "created_at"],
        schema="data",
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table("agent_render_jobs", schema="data")
    op.drop_table("labelling_agents", schema="data")
