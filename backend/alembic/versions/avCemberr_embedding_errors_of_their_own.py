"""Embedding runs keep their own errors

They were appended to registration_errors with an "Embeddings:" prefix, so
they showed up in the imagery error list and a new imagery registration
wiped them. They move to embedding_errors, without the prefix.

Revision ID: avCemberr
Revises: avBgencfg
Create Date: 2026-10-23
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "avCemberr"
down_revision: str | Sequence[str] | None = "avBgencfg"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

IS_EMBEDDING = (
    "(e->>'error' LIKE 'Embeddings: %' OR e->>'error' LIKE 'Embedding computation %')"
)


def upgrade() -> None:
    op.add_column(
        "campaigns", sa.Column("embedding_errors", JSONB(), nullable=True), schema="data"
    )
    op.execute(
        f"""
        UPDATE data.campaigns SET
            embedding_errors = (
                SELECT jsonb_agg(e || jsonb_build_object(
                    'error', regexp_replace(e->>'error', '^Embeddings: ', '')))
                FROM jsonb_array_elements(registration_errors) e WHERE {IS_EMBEDDING}
            ),
            registration_errors = (
                SELECT jsonb_agg(e) FROM jsonb_array_elements(registration_errors) e
                WHERE NOT {IS_EMBEDDING}
            )
        WHERE jsonb_typeof(registration_errors) = 'array'
        """
    )


def downgrade() -> None:
    op.execute(
        """
        UPDATE data.campaigns SET registration_errors = NULLIF(
            COALESCE(registration_errors, '[]'::jsonb) || COALESCE((
                SELECT jsonb_agg(e || jsonb_build_object('error', 'Embeddings: ' || (e->>'error')))
                FROM jsonb_array_elements(embedding_errors) e
            ), '[]'::jsonb), '[]'::jsonb)
        WHERE embedding_errors IS NOT NULL
        """
    )
    op.drop_column("campaigns", "embedding_errors", schema="data")
