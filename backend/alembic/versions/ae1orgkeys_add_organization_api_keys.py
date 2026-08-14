"""Organization-level provider API keys, shared by that org's campaigns.

Revision ID: ae1orgkeys
Revises: ad1orgjoin
Create Date: 2026-08-14 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "ae1orgkeys"
down_revision: str | Sequence[str] | None = "ad1orgjoin"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "organization_api_keys",
        sa.Column("id", sa.Integer(), sa.Identity(always=True), primary_key=True),
        sa.Column("organization_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("encrypted_key", sa.Text(), nullable=False),
        sa.Column("created_by", sa.Uuid(), nullable=True),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.text("current_timestamp"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["organization_id"], ["data.organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by"], ["auth.users.id"], ondelete="SET NULL"),
        sa.UniqueConstraint("organization_id", "name", name="organization_api_keys_name_uniq"),
        schema="data",
    )
    # Imagery that leans on a shared key instead of holding its own. Dropping
    # the key leaves the layer without one rather than deleting the layer.
    for table in ("imagery_sources", "basemaps"):
        op.add_column(
            table,
            sa.Column("organization_api_key_id", sa.Integer(), nullable=True),
            schema="data",
        )
        op.create_foreign_key(
            f"{table}_organization_api_key_fk",
            table,
            "organization_api_keys",
            ["organization_api_key_id"],
            ["id"],
            source_schema="data",
            referent_schema="data",
            ondelete="SET NULL",
        )


def downgrade() -> None:
    for table in ("imagery_sources", "basemaps"):
        op.drop_constraint(f"{table}_organization_api_key_fk", table, schema="data")
        op.drop_column(table, "organization_api_key_id", schema="data")
    op.drop_table("organization_api_keys", schema="data")
