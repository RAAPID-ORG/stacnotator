"""Add managed cloud imagery catalogs (issue #158)

Revision ID: bt1cloudcat
Revises: at1mapaccess
Create Date: 2026-09-30
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "bt1cloudcat"
down_revision = "at1mapaccess"
branch_labels = None
depends_on = None

TS = sa.TIMESTAMP(timezone=True)


def upgrade() -> None:
    op.create_table(
        "cloud_imagery_collections",
        sa.Column("id", sa.Integer(), sa.Identity(always=True), primary_key=True),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column(
            "project_id",
            sa.Integer(),
            sa.ForeignKey("data.projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("tiler", sa.String(64), nullable=False),
        sa.Column("stac_collection_id", sa.String(64), nullable=False, unique=True),
        sa.Column("container_url", sa.Text(), nullable=False),
        sa.Column("prefix", sa.Text(), nullable=False, server_default=""),
        sa.Column("storage_auth", sa.String(32), nullable=True),
        sa.Column("encrypted_storage_secret", sa.Text(), nullable=True),
        sa.Column("storage_secret_expires_at", TS, nullable=True),
        sa.Column("data_region", sa.String(64), nullable=True),
        sa.Column("bbox", postgresql.JSONB(), nullable=True),
        sa.Column("interval", postgresql.JSONB(), nullable=True),
        sa.Column("item_count", sa.Integer(), nullable=True),
        sa.Column("visualizations", postgresql.JSONB(), nullable=False, server_default="[]"),
        sa.Column("created_at", TS, server_default=sa.func.now(), nullable=False),
        schema="data",
    )
    op.create_index(
        "ix_data_cloud_imagery_collections_project_id",
        "cloud_imagery_collections",
        ["project_id"],
        schema="data",
    )
    op.create_table(
        "cloud_imagery_imports",
        sa.Column("id", sa.Integer(), sa.Identity(always=True), primary_key=True),
        sa.Column(
            "collection_id",
            sa.Integer(),
            sa.ForeignKey("data.cloud_imagery_collections.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
        ),
        sa.Column("status", sa.String(16), nullable=True),
        sa.Column("heartbeat_at", TS, nullable=True),
        sa.Column("errors", postgresql.JSONB(), nullable=False, server_default="[]"),
        sa.Column("attempt", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("reset_pending", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", TS, server_default=sa.func.now(), nullable=False),
        schema="data",
    )
    op.create_table(
        "cloud_imagery_files",
        sa.Column("id", sa.Integer(), sa.Identity(always=True), primary_key=True),
        sa.Column(
            "import_id",
            sa.Integer(),
            sa.ForeignKey("data.cloud_imagery_imports.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("path", sa.Text(), nullable=False),
        sa.Column("etag", sa.Text(), nullable=False),
        sa.Column("instant", sa.Boolean(), nullable=False),
        sa.Column("start_datetime", TS, nullable=False),
        sa.Column("end_datetime", TS, nullable=False),
        sa.Column("item_id", sa.String(64), nullable=True),
        sa.UniqueConstraint("import_id", "path", name="cloud_imagery_files_path_uq"),
        schema="data",
    )
    op.add_column(
        "collection_stac_configs",
        sa.Column(
            "cloud_collection_id",
            sa.Integer(),
            sa.ForeignKey("data.cloud_imagery_collections.id", ondelete="RESTRICT"),
            nullable=True,
        ),
        schema="data",
    )
    op.create_index(
        "ix_data_collection_stac_configs_cloud_collection_id",
        "collection_stac_configs",
        ["cloud_collection_id"],
        schema="data",
    )


def downgrade() -> None:
    op.drop_index(
        "ix_data_collection_stac_configs_cloud_collection_id",
        table_name="collection_stac_configs",
        schema="data",
    )
    op.drop_column("collection_stac_configs", "cloud_collection_id", schema="data")
    op.drop_table("cloud_imagery_files", schema="data")
    op.drop_table("cloud_imagery_imports", schema="data")
    op.drop_table("cloud_imagery_collections", schema="data")
