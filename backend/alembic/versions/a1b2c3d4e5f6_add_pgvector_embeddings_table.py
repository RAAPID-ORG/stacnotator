"""add pgvector embeddings table

Revision ID: a1b2c3d4e5f6
Revises: b5eab45ffd41
Create Date: 2026-02-09 12:00:00.000000

"""
from typing import Sequence, Union
import logging
import sys

from alembic import op
import sqlalchemy as sa

logger = logging.getLogger(__name__)


def _ensure_stdout_logging() -> None:
    """Ensure migration logs are visible in stdout during Alembic runs."""
    if not logger.handlers:
        handler = logging.StreamHandler(sys.stdout)
        handler.setFormatter(logging.Formatter("%(levelname)s %(message)s"))
        logger.addHandler(handler)
    logger.setLevel(logging.INFO)
    logger.propagate = False

# revision identifiers, used by Alembic.
revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, Sequence[str], None] = 'b5eab45ffd41'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _backfill_embeddings() -> None:
    """Best-effort backfill of embeddings for all existing campaigns.

    Requires GEE credentials to be available.  If anything fails the
    schema migration still succeeds - embeddings can be populated later
    via the backfill_embeddings.py script or on next campaign edit.
    """
    from sqlalchemy.orm import Session
    from src.utils import initialize_earth_engine
    from src.database import Base  # noqa - ensures models are registered
    from src.campaigns.models import Campaign
    from src.annotation import embeddings_service
    from datetime import datetime

    _ensure_stdout_logging()
    initialize_earth_engine()

    bind = op.get_bind()
    session = Session(bind=bind)

    campaigns = session.execute(sa.select(Campaign)).scalars().all()
    logger.info("Backfilling embeddings for %d campaign(s)…", len(campaigns))

    for campaign in campaigns:
        try:
            year = campaign.settings.embedding_year if campaign.settings else None
            if year is None:
                logger.info(
                    "  Campaign %d (%s): no embedding year set – skipping.",
                    campaign.id, campaign.name,
                )
                continue
            start_date = datetime(year, 1, 1)
            end_date = datetime(year, 12, 31)
            summary = embeddings_service.populate_campaign_embeddings(
                session, campaign.id, start_date, end_date,
            )
            logger.info(
                "  Campaign %d (%s): created=%d skipped=%d failed=%d",
                campaign.id, campaign.name,
                summary["created"], summary["skipped"], summary["failed"],
            )
        except Exception as exc:
            logger.warning(
                "  Campaign %d (%s): skipped - %s", campaign.id, campaign.name, exc,
            )

    session.flush()


def upgrade() -> None:
    # Enable pgvector extension
    op.execute("CREATE EXTENSION IF NOT EXISTS vector SCHEMA public")

    # Drop old embeddings table if it exists (was JSONB-based)
    op.execute("DROP TABLE IF EXISTS data.embeddings CASCADE")

    # Create embeddings table with native vector(64) column
    op.execute("""
        CREATE TABLE data.embeddings (
            id          INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
            annotation_task_id INTEGER NOT NULL REFERENCES data.annotation_tasks(id) ON DELETE CASCADE,
            vector      vector(64) NOT NULL,
            lat         DOUBLE PRECISION NOT NULL,
            lon         DOUBLE PRECISION NOT NULL,
            period_start TIMESTAMPTZ NOT NULL,
            period_end   TIMESTAMPTZ NOT NULL
        )
    """)

    # HNSW index for fast cosine similarity search
    op.execute(
        "CREATE INDEX idx_embeddings_vector_cosine "
        "ON data.embeddings USING hnsw (vector vector_cosine_ops) "
        "WITH (m = 16, ef_construction = 64)"
    )

    # Backfill embeddings for existing campaigns (best-effort)
    try:
        _backfill_embeddings()
    except Exception as exc:
        logger.warning(
            "Embedding backfill skipped - can be run later via backfill_embeddings.py: %s", exc,
        )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS data.embeddings CASCADE")
    op.execute("DROP EXTENSION IF EXISTS vector")
