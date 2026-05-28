"""add custom_maps

Revision ID: r1a2b3c4d5e6
Revises: q1a2b3c4d5e6
Create Date: 2026-05-28
"""

import sqlalchemy as sa
from geoalchemy2 import Geometry
from sqlalchemy.dialects.postgresql import UUID

from alembic import op

revision = "r1a2b3c4d5e6"
down_revision = "q1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "custom_maps",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "campaign_id",
            sa.Integer(),
            sa.ForeignKey("data.campaigns.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "uploaded_by_user_id",
            UUID(as_uuid=True),
            sa.ForeignKey("auth.users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
        sa.Column("source_path", sa.Text(), nullable=False),
        sa.Column("cog_path", sa.Text(), nullable=True),
        sa.Column("bounds", Geometry("POLYGON", srid=4326), nullable=True),
        sa.Column("display_order", sa.SmallInteger(), nullable=False, server_default="0"),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.func.current_timestamp(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.func.current_timestamp(),
            nullable=False,
        ),
        sa.CheckConstraint(
            "status IN ('pending', 'processing', 'ready', 'failed')",
            name="custom_maps_status_check",
        ),
        schema="data",
    )
    op.create_index(
        "ix_custom_maps_campaign_order",
        "custom_maps",
        ["campaign_id", "display_order"],
        schema="data",
    )
    op.create_index(
        "ix_custom_maps_bounds",
        "custom_maps",
        ["bounds"],
        postgresql_using="gist",
        schema="data",
    )


def downgrade() -> None:
    op.drop_index("ix_custom_maps_bounds", table_name="custom_maps", schema="data")
    op.drop_index("ix_custom_maps_campaign_order", table_name="custom_maps", schema="data")
    op.drop_table("custom_maps", schema="data")
