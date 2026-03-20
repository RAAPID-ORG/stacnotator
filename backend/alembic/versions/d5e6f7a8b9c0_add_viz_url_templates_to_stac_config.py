"""Add viz_url_templates to collection_stac_configs

Stores the tile URL templates (with {searchId} placeholders) so that STAC
mosaics can be re-registered when the campaign bounding box is updated.

Backfill strategy: for each STAC collection with ≥ 2 slices, compare tile URLs
across slices to identify the searchId segment and reconstruct the template.
Collections with only 1 slice are skipped (template stays NULL).

Revision ID: d5e6f7a8b9c0
Revises: c4d5e6f7a8b9
Create Date: 2026-03-20 10:00:00.000000

"""

from __future__ import annotations

import json
import logging
from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

from alembic import op

logger = logging.getLogger(__name__)

revision: str = "d5e6f7a8b9c0"
down_revision: str | None = "c4d5e6f7a8b9"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SEARCH_ID_PLACEHOLDER = "{searchId}"


def _derive_template(url_a: str, url_b: str) -> str | None:
    """
    Given two resolved tile URLs that differ only by the searchId segment,
    reconstruct the template by replacing the differing path segment with {searchId}.
    Returns None if the URLs don't have a single differing path segment.
    """
    # Split on '/' keeping the query string intact
    parts_a = url_a.split("/")
    parts_b = url_b.split("/")

    if len(parts_a) != len(parts_b):
        return None

    diffs = [(i, pa, pb) for i, (pa, pb) in enumerate(zip(parts_a, parts_b)) if pa != pb]

    if len(diffs) != 1:
        return None

    idx, _, _ = diffs[0]
    parts_a[idx] = SEARCH_ID_PLACEHOLDER
    return "/".join(parts_a)


def upgrade() -> None:
    # 1. Add the column
    op.add_column(
        "collection_stac_configs",
        sa.Column("viz_url_templates", JSONB, nullable=True),
        schema="data",
    )

    # 2. Best-effort backfill
    conn = op.get_bind()

    # Get all STAC configs
    stac_configs = conn.execute(
        sa.text("""
            SELECT csc.collection_id
            FROM data.collection_stac_configs csc
        """)
    ).fetchall()

    for (collection_id,) in stac_configs:
        # Get the first two slices ordered by display_order
        slices = conn.execute(
            sa.text("""
                SELECT s.id
                FROM data.imagery_slices s
                WHERE s.collection_id = :cid
                ORDER BY s.display_order
                LIMIT 2
            """),
            {"cid": collection_id},
        ).fetchall()

        if len(slices) < 2:
            logger.info(
                "Collection %s has < 2 slices — skipping viz_url_templates backfill",
                collection_id,
            )
            continue

        slice_a_id, slice_b_id = slices[0][0], slices[1][0]

        # Get tile URLs for both slices
        urls_a = conn.execute(
            sa.text("""
                SELECT visualization_name, tile_url
                FROM data.slice_tile_urls
                WHERE slice_id = :sid
                ORDER BY visualization_name
            """),
            {"sid": slice_a_id},
        ).fetchall()

        urls_b = conn.execute(
            sa.text("""
                SELECT visualization_name, tile_url
                FROM data.slice_tile_urls
                WHERE slice_id = :sid
                ORDER BY visualization_name
            """),
            {"sid": slice_b_id},
        ).fetchall()

        if len(urls_a) != len(urls_b) or not urls_a:
            continue

        templates = []
        success = True
        for (viz_a, url_a), (viz_b, url_b) in zip(urls_a, urls_b):
            if viz_a != viz_b:
                success = False
                break
            tmpl = _derive_template(url_a, url_b)
            if tmpl is None:
                success = False
                break
            templates.append({"viz_name": viz_a, "url_template": tmpl})

        if success and templates:
            conn.execute(
                sa.text("""
                    UPDATE data.collection_stac_configs
                    SET viz_url_templates = :templates
                    WHERE collection_id = :cid
                """),
                {"templates": json.dumps(templates), "cid": collection_id},
            )
            logger.info(
                "Backfilled viz_url_templates for collection %s (%d templates)",
                collection_id,
                len(templates),
            )
        else:
            logger.warning(
                "Could not derive viz_url_templates for collection %s — left as NULL",
                collection_id,
            )


def downgrade() -> None:
    op.drop_column("collection_stac_configs", "viz_url_templates", schema="data")
