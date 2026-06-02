"""Add custom_maps table for user-uploaded overlay rasters

Revision ID: t1a2b3c4d5e6
Revises: r1a2b3c4d5e6
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision: str = "t1a2b3c4d5e6"
down_revision: str | None = "r1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Drop first in case a partial table was created outside of Alembic
    op.execute("DROP TABLE IF EXISTS data.custom_maps CASCADE")
    op.create_table(
        "custom_maps",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "campaign_id",
            sa.Integer,
            sa.ForeignKey("data.campaigns.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "uploaded_by",
            UUID(as_uuid=True),
            sa.ForeignKey("auth.users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("name", sa.Text, nullable=False),
        sa.Column("status", sa.String(30), nullable=False, server_default="pending_processing"),
        sa.Column("original_key", sa.Text, nullable=False),
        sa.Column("cog_key", sa.Text, nullable=True),
        sa.Column("band_count", sa.Integer, nullable=True),
        sa.Column("nodata", sa.Float, nullable=True),
        sa.Column("bounds", JSONB, nullable=True),
        sa.Column("viz_params", JSONB, nullable=True),
        sa.Column("error", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime, server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime, server_default=sa.text("now()"), nullable=False),
        schema="data",
    )
    op.create_index("ix_custom_maps_campaign_id", "custom_maps", ["campaign_id"], schema="data")


def downgrade() -> None:
    op.drop_index("ix_custom_maps_campaign_id", table_name="custom_maps", schema="data")
    op.drop_table("custom_maps", schema="data")
