import sqlalchemy as sa
from alembic import op

revision = "avSagentretry"
down_revision = "avRcustomidx"


def upgrade() -> None:
    op.add_column(
        "task_assignments", sa.Column("deferred_at", sa.DateTime(timezone=True)), schema="data"
    )


def downgrade() -> None:
    op.drop_column("task_assignments", "deferred_at", schema="data")
