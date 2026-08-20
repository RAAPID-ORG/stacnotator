"""tombstone deleted annotations so the changes poll can report them

A deletion is the one change that leaves no row to read, so it gets a record of
its own. Rows are pruned past the retention window; a client whose cursor is
older than that refetches its tiles instead.

Revision ID: an1anndel
Revises: am1annotchg
Create Date: 2026-08-20
"""

import sqlalchemy as sa

from alembic import op

revision = "an1anndel"
down_revision = "am1annotchg"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "deleted_annotations",
        sa.Column("annotation_id", sa.Integer(), primary_key=True, autoincrement=False),
        sa.Column(
            "campaign_id",
            sa.Integer(),
            sa.ForeignKey("data.campaigns.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "deleted_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        schema="data",
    )
    op.create_index(
        "idx_deleted_annotations_campaign_deleted_at",
        "deleted_annotations",
        ["campaign_id", "deleted_at"],
        schema="data",
    )


def downgrade() -> None:
    op.drop_index(
        "idx_deleted_annotations_campaign_deleted_at",
        table_name="deleted_annotations",
        schema="data",
    )
    op.drop_table("deleted_annotations", schema="data")
