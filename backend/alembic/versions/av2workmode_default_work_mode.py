"""Campaign mode becomes the default work mode, named as the UI names it.

Every campaign supports both task work and free exploration since the labelling
policy (z1labelpolicy); the column only picks which one the annotation page opens
in. 'open' was the old name for Explore.

Revision ID: av2workmode
Revises: av1platadmin
Create Date: 2026-10-23
"""

from collections.abc import Sequence

from alembic import op

revision: str = "av2workmode"
down_revision: str | Sequence[str] | None = "av1platadmin"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.alter_column("campaigns", "mode", new_column_name="default_work_mode", schema="data")
    op.execute(
        "UPDATE data.campaigns SET default_work_mode = 'explore' WHERE default_work_mode <> 'tasks'"
    )
    op.create_check_constraint(
        "campaigns_default_work_mode_values",
        "campaigns",
        "default_work_mode IN ('tasks', 'explore')",
        schema="data",
    )


def downgrade() -> None:
    op.drop_constraint(
        "campaigns_default_work_mode_values", "campaigns", type_="check", schema="data"
    )
    op.execute(
        "UPDATE data.campaigns SET default_work_mode = 'open' WHERE default_work_mode = 'explore'"
    )
    op.alter_column("campaigns", "default_work_mode", new_column_name="mode", schema="data")
