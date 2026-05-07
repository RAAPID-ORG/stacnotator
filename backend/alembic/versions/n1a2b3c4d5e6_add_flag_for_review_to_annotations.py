"""add flagged_for_review and flag_comment to annotations

Revision ID: n1a2b3c4d5e6
Revises: m1a2b3c4d5e6
Create Date: 2026-05-06
"""

import sqlalchemy as sa

from alembic import op

revision = "n1a2b3c4d5e6"
down_revision = "m1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "annotations",
        sa.Column(
            "flagged_for_review",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
        schema="data",
    )
    op.add_column(
        "annotations",
        sa.Column("flag_comment", sa.Text(), nullable=True),
        schema="data",
    )


def downgrade() -> None:
    op.drop_column("annotations", "flag_comment", schema="data")
    op.drop_column("annotations", "flagged_for_review", schema="data")
