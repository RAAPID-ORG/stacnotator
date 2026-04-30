"""add stac_item JSONB to mosaic_items + backfill

Stores the full STAC item JSON (assets included) so the tiler can skip the
HTTP fetch to the source catalog at tile-serving time. Existing rows are
backfilled by HTTP-fetching each unique href in parallel; failures are
logged and the row is left NULL (the tiler falls back to fetching at
request time, which is the legacy behavior). The backfill is idempotent -
safe to re-run by re-applying the migration on a clean column.

Revision ID: m1a2b3c4d5e6
Revises: l1a2b3c4d5e6
Create Date: 2026-04-30
"""

import json
import logging
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "m1a2b3c4d5e6"
down_revision = "l1a2b3c4d5e6"
branch_labels = None
depends_on = None

logger = logging.getLogger("alembic.runtime.migration")

BACKFILL_WORKERS = 16
BACKFILL_TIMEOUT = 30
BACKFILL_PROGRESS_EVERY = 100


def _fetch(href: str) -> tuple[str, dict | None]:
    req = urllib.request.Request(href, headers={"User-Agent": "stacnotator-migration"})
    try:
        with urllib.request.urlopen(req, timeout=BACKFILL_TIMEOUT) as resp:
            return href, json.loads(resp.read())
    except Exception as e:
        logger.warning("Backfill: failed to fetch %s: %s", href, e)
        return href, None


def upgrade() -> None:
    op.add_column(
        "mosaic_items",
        sa.Column("stac_item", JSONB(), nullable=True),
        schema="data",
    )

    bind = op.get_bind()
    rows = bind.execute(
        sa.text(
            "SELECT id, href FROM data.mosaic_items WHERE stac_item IS NULL"
        )
    ).fetchall()

    if not rows:
        return

    by_href: dict[str, list[int]] = {}
    for row_id, href in rows:
        by_href.setdefault(href, []).append(row_id)

    total = len(by_href)
    logger.info("Backfilling stac_item: %d rows across %d unique hrefs", len(rows), total)

    done = succeeded = 0
    with ThreadPoolExecutor(max_workers=BACKFILL_WORKERS) as ex:
        futures = [ex.submit(_fetch, href) for href in by_href]
        for fut in as_completed(futures):
            href, item = fut.result()
            done += 1
            if done % BACKFILL_PROGRESS_EVERY == 0:
                logger.info("Backfill progress: %d/%d", done, total)
            if item is None:
                continue
            bind.execute(
                sa.text(
                    "UPDATE data.mosaic_items SET stac_item = CAST(:item AS jsonb) "
                    "WHERE id = ANY(:ids)"
                ),
                {"item": json.dumps(item), "ids": by_href[href]},
            )
            succeeded += 1

    logger.info("Backfill complete: %d/%d unique hrefs filled", succeeded, total)


def downgrade() -> None:
    op.drop_column("mosaic_items", "stac_item", schema="data")
