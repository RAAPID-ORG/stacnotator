"""Drop legacy stac columns from collection_stac_configs

Removes registration_url, search_body, and viz_url_templates which were used
by the legacy 'stac' collection type. All collections now use the stac_browser
path (catalog_url + stac_collection_id).

Revision ID: r1a2b3c4d5e6
Revises: q1a2b3c4d5e6
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "r1a2b3c4d5e6"
down_revision: str | None = "s1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_column("collection_stac_configs", "registration_url", schema="data")
    op.drop_column("collection_stac_configs", "search_body", schema="data")
    op.drop_column("collection_stac_configs", "viz_url_templates", schema="data")


def downgrade() -> None:
    op.add_column(
        "collection_stac_configs",
        sa.Column("viz_url_templates", JSONB, nullable=True),
        schema="data",
    )
    op.add_column(
        "collection_stac_configs",
        sa.Column("search_body", sa.Text, nullable=False, server_default=""),
        schema="data",
    )
    op.add_column(
        "collection_stac_configs",
        sa.Column("registration_url", sa.Text, nullable=False, server_default=""),
        schema="data",
    )
