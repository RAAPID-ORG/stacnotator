"""record per-campaign research-sharing consent

One row per annotator per campaign, written only when they answer the prompt.
No row means never asked, which we treat as no sharing.

Revision ID: ak1datashare
Revises: aj1terms
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "ak1datashare"
down_revision: str | Sequence[str] | None = "aj1terms"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "campaign_data_sharing",
        sa.Column(
            "campaign_id",
            sa.Integer(),
            sa.ForeignKey("data.campaigns.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "user_id",
            sa.UUID(),
            sa.ForeignKey("auth.users.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("choice", sa.String(20), nullable=False),
        sa.Column(
            "decided_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("current_timestamp"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "choice IN ('none', 'anonymous', 'attributed')",
            name="campaign_data_sharing_choice_check",
        ),
        schema="data",
    )


def downgrade() -> None:
    op.drop_table("campaign_data_sharing", schema="data")
