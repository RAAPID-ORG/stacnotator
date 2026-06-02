"""Add unique constraint on (campaign_id, name) for custom_maps

Revision ID: w1a2b3c4d5e6
Revises: v1a2b3c4d5e6
"""

from alembic import op

revision: str = "w1a2b3c4d5e6"
down_revision: str | None = "v1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_unique_constraint(
        "uq_custom_maps_campaign_name",
        "custom_maps",
        ["campaign_id", "name"],
        schema="data",
    )


def downgrade() -> None:
    op.drop_constraint(
        "uq_custom_maps_campaign_name",
        "custom_maps",
        schema="data",
    )
