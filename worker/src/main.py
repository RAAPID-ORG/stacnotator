"""Worker main loop - polls DB for pending tasks and dispatches to task handlers."""

import logging
import time
import uuid as _uuid

import sqlalchemy as sa
from sqlalchemy import Float, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from src.config import get_settings
from src.database import make_session
from src.tasks import cog_convert

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger(__name__)


class Base(DeclarativeBase):
    pass


class CustomMap(Base):
    __tablename__ = "custom_maps"
    __table_args__ = {"schema": "data"}

    id: Mapped[_uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    campaign_id: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(30), nullable=False)
    original_key: Mapped[str] = mapped_column(Text, nullable=False)
    cog_key: Mapped[str | None] = mapped_column(Text, nullable=True)
    band_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    nodata: Mapped[float | None] = mapped_column(Float, nullable=True)
    bounds: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    viz_params: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)


def _process_pending(db) -> int:
    pending = (
        db.query(CustomMap)
        .filter(CustomMap.status == "pending_processing")
        .all()
    )
    for item in pending:
        logger.info("processing custom map %s", item.id)
        item.status = "processing"
        db.commit()
        try:
            cog_convert.process(db, item)
        except Exception as exc:
            logger.exception("failed to process custom map %s", item.id)
            item.status = "failed"
            item.error = str(exc)
            db.commit()
    return len(pending)


def main() -> None:
    settings = get_settings()
    logger.info("worker starting, poll_interval=%ds", settings.POLL_INTERVAL_S)

    while True:
        try:
            db = make_session()
            try:
                count = _process_pending(db)
                if count == 0:
                    logger.debug("no pending items")
            finally:
                db.close()
        except Exception:
            logger.exception("worker iteration failed")

        time.sleep(settings.POLL_INTERVAL_S)


if __name__ == "__main__":
    main()
