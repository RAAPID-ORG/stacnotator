"""scope agent queues and defer unresolved tasks

Revision ID: bdc7f12f440a
Revises: avRcustomidx
Create Date: 2026-11-13 09:59:13.045214

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "bdc7f12f440a"
down_revision: Union[str, Sequence[str], None] = "avRcustomidx"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "labelling_agents", sa.Column("task_set_id", sa.Integer(), nullable=True), schema="data"
    )
    op.create_foreign_key(
        "fk_labelling_agents_task_set_id",
        "labelling_agents",
        "task_sets",
        ["task_set_id"],
        ["id"],
        source_schema="data",
        referent_schema="data",
        ondelete="CASCADE",
    )
    op.create_index(
        "ix_data_labelling_agents_task_set_id", "labelling_agents", ["task_set_id"], schema="data"
    )
    op.create_table(
        "agent_task_deferrals",
        sa.Column(
            "agent_id",
            sa.UUID(),
            sa.ForeignKey("data.labelling_agents.user_id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "task_id",
            sa.Integer(),
            sa.ForeignKey("data.tasks.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        schema="data",
    )
    op.create_index(
        "ix_data_agent_task_deferrals_task_id", "agent_task_deferrals", ["task_id"], schema="data"
    )


def downgrade() -> None:
    op.drop_table("agent_task_deferrals", schema="data")
    op.drop_index(
        "ix_data_labelling_agents_task_set_id", table_name="labelling_agents", schema="data"
    )
    op.drop_constraint(
        "fk_labelling_agents_task_set_id", "labelling_agents", schema="data", type_="foreignkey"
    )
    op.drop_column("labelling_agents", "task_set_id", schema="data")
