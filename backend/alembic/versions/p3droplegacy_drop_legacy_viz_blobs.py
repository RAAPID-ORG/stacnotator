"""drop legacy viz_params/cover_viz_params/visualizations blobs from collection_stac_configs

These three JSONB columns are made redundant by collection_viz_configs (Phase 8 inc 1-6).
Dual-write was in place since inc 2; the read path was switched to collection_viz_configs
in inc 5. This migration first backfills collection_viz_configs from the legacy blobs, then
removes the now-dead storage columns.

The backfill is integrated here (it must run while the legacy columns still exist) and is
idempotent: on a fresh/empty DB it inserts nothing, and ON CONFLICT guards against rows the
dual-write path already created. Because the whole migration runs in one transaction, a
backfill failure aborts the column drops.

IMPORTANT: downgrade re-adds the columns but does NOT restore data — this is a one-way
migration. Recovery of dropped blob data requires a pre-migration backup.

Revision ID: p3droplegacy
Revises: p2tileurlfk
Create Date: 2026-06-20 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "p3droplegacy"
down_revision: str | Sequence[str] | None = "p2tileurlfk"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Step 1: fan out the authoritative `visualizations` JSONB array into one
    # collection_viz_configs row per named viz. display_order follows array order.
    op.execute(
        """
        INSERT INTO data.collection_viz_configs
            (collection_id, name, display_order, render_params, cover_render_params)
        SELECT
            sc.collection_id,
            (elem->>'name')::varchar,
            (row_number() OVER (PARTITION BY sc.collection_id ORDER BY idx))::smallint - 1,
            (elem->'viz_params')::jsonb,
            CASE
                WHEN elem->>'cover_viz_params' IS NULL
                     OR elem->'cover_viz_params' = 'null'::jsonb
                    THEN NULL
                ELSE (elem->'cover_viz_params')::jsonb
            END
        FROM data.collection_stac_configs sc,
             jsonb_array_elements(sc.visualizations) WITH ORDINALITY AS arr(elem, idx)
        WHERE sc.visualizations IS NOT NULL
          AND elem->'viz_params' IS NOT NULL
          AND elem->'viz_params' <> 'null'::jsonb
        ON CONFLICT (collection_id, name) DO NOTHING;
        """
    )

    # Step 2: legacy rows (visualizations IS NULL) only have the first-viz blob.
    # Fan that single blob across the source's visualization_templates names.
    op.execute(
        """
        INSERT INTO data.collection_viz_configs
            (collection_id, name, display_order, render_params, cover_render_params)
        SELECT
            sc.collection_id,
            vt.name,
            vt.display_order,
            sc.viz_params,
            CASE WHEN ic.has_dedicated_cover THEN sc.cover_viz_params ELSE NULL END
        FROM data.collection_stac_configs sc
        JOIN data.imagery_collections ic ON ic.id = sc.collection_id
        JOIN data.visualization_templates vt ON vt.source_id = ic.source_id
        WHERE sc.visualizations IS NULL
          AND sc.viz_params IS NOT NULL
        ON CONFLICT (collection_id, name) DO NOTHING;
        """
    )

    # The legacy storage is now redundant — drop it.
    op.drop_column("collection_stac_configs", "viz_params", schema="data")
    op.drop_column("collection_stac_configs", "cover_viz_params", schema="data")
    op.drop_column("collection_stac_configs", "visualizations", schema="data")


def downgrade() -> None:
    # NOTE: downgrade re-adds the columns as nullable JSONB but does NOT restore data.
    # Once dropped, recovery requires restoring from a pre-migration backup.
    op.add_column(
        "collection_stac_configs",
        sa.Column("visualizations", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        schema="data",
    )
    op.add_column(
        "collection_stac_configs",
        sa.Column("cover_viz_params", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        schema="data",
    )
    op.add_column(
        "collection_stac_configs",
        sa.Column("viz_params", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        schema="data",
    )
