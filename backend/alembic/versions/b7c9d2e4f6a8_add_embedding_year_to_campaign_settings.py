"""add embedding_year to campaign settings

Revision ID: b7c9d2e4f6a8
Revises: a1b2c3d4e5f6
Create Date: 2026-02-26 12:00:00.000000

"""

import logging
import sys
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

logger = logging.getLogger(__name__)


def _ensure_stdout_logging() -> None:
    if not logger.handlers:
        handler = logging.StreamHandler(sys.stdout)
        handler.setFormatter(logging.Formatter("%(levelname)s %(message)s"))
        logger.addHandler(handler)
    logger.setLevel(logging.INFO)
    logger.propagate = False


# revision identifiers, used by Alembic.
revision: str = "b7c9d2e4f6a8"
down_revision: str | Sequence[str] | None = "a1b2c3d4e5f6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _backfill_embedding_year() -> None:
    """Set embedding_year for existing campaigns to the latest imagery year."""
    _ensure_stdout_logging()

    bind = op.get_bind()

    # For each campaign, derive the latest imagery year and store it
    result = bind.execute(
        sa.text("""
        UPDATE data.settings s
        SET embedding_year = sub.latest_year
        FROM (
            SELECT
                i.campaign_id,
                CAST(LEFT(MAX(i.end_ym), 4) AS INTEGER) AS latest_year
            FROM data.imagery i
            GROUP BY i.campaign_id
        ) sub
        WHERE s.campaign_id = sub.campaign_id
          AND s.embedding_year IS NULL
    """)
    )
    logger.info("Backfilled embedding_year for %d campaign(s)", result.rowcount)


def upgrade() -> None:
    # Add nullable embedding_year column
    op.add_column(
        "settings",
        sa.Column("embedding_year", sa.Integer(), nullable=True),
        schema="data",
    )

    # Backfill from existing imagery
    try:
        _backfill_embedding_year()
    except Exception as exc:
        logger.warning("Embedding year backfill skipped: %s", exc)


def downgrade() -> None:
    op.drop_column("settings", "embedding_year", schema="data")
