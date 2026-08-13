"""Persist temporal imagery generation series.

Revision ID: ac1imggen
Revises: ab1heartbeat

Historical collections are deliberately left unassociated. Their normalized
rows describe rendered imagery, but they do not prove which generator inputs
created them. New and subsequently regenerated series are persisted through
the typed editor interface.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "ac1imggen"
down_revision: str | Sequence[str] | None = "ab1heartbeat"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.alter_column(
        "imagery_sources",
        "default_zoom",
        server_default="15",
        schema="data",
    )
    op.create_table(
        "imagery_generation_series",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("source_id", sa.Integer(), nullable=False),
        sa.Column("config", postgresql.JSONB(), nullable=False),
        sa.ForeignKeyConstraint(
            ["source_id"],
            ["data.imagery_sources.id"],
            ondelete="CASCADE",
        ),
        schema="data",
    )
    op.create_index(
        "idx_imagery_generation_series_source_id",
        "imagery_generation_series",
        ["source_id"],
        schema="data",
    )
    op.add_column(
        "imagery_collections",
        sa.Column("generation_series_id", sa.Integer(), nullable=True),
        schema="data",
    )
    op.create_foreign_key(
        "imagery_collections_generation_series_id_fkey",
        "imagery_collections",
        "imagery_generation_series",
        ["generation_series_id"],
        ["id"],
        source_schema="data",
        referent_schema="data",
        ondelete="SET NULL",
    )
    op.create_index(
        "idx_imagery_collections_generation_series_id",
        "imagery_collections",
        ["generation_series_id"],
        schema="data",
    )


def downgrade() -> None:
    op.drop_index(
        "idx_imagery_collections_generation_series_id",
        table_name="imagery_collections",
        schema="data",
    )
    op.drop_constraint(
        "imagery_collections_generation_series_id_fkey",
        "imagery_collections",
        type_="foreignkey",
        schema="data",
    )
    op.drop_column("imagery_collections", "generation_series_id", schema="data")
    op.drop_index(
        "idx_imagery_generation_series_source_id",
        table_name="imagery_generation_series",
        schema="data",
    )
    op.drop_table("imagery_generation_series", schema="data")
    op.alter_column(
        "imagery_sources",
        "default_zoom",
        server_default="14",
        schema="data",
    )
