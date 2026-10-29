"""A generation series stores only what its collections do not

The STAC generator's config repeated the catalog, search and renderings that
every collection it produced stores too, and went stale the first time one of
those collections was edited. It keeps the period and how it was cut; the
rest is read off the collections. The version field nothing branched on goes
from both kinds.

Revision ID: avBgencfg
Revises: avAcampcfg
Create Date: 2026-10-23
"""

from collections.abc import Sequence

from alembic import op

revision: str = "avBgencfg"
down_revision: str | Sequence[str] | None = "avAcampcfg"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

KEPT = (
    "kind",
    "collection_title",
    "has_cloud_cover",
    "start_date",
    "end_date",
    "collection_period_interval",
    "collection_period_unit",
    "slice_period_interval",
    "slice_period_unit",
    "cover_mode",
    "cover_slice_nth",
)


def upgrade() -> None:
    kept = ", ".join(f"'{key}', config->'{key}'" for key in KEPT)
    op.execute(
        f"UPDATE data.imagery_generation_series SET config = jsonb_build_object({kept}) "
        "WHERE config->>'kind' = 'stac'"
    )
    op.execute(
        "UPDATE data.imagery_generation_series SET config = config - 'version' "
        "WHERE config->>'kind' = 'planet_scenes'"
    )


def downgrade() -> None:
    # The dropped STAC fields are read off the series' first collection.
    op.execute(
        """
        UPDATE data.imagery_generation_series g SET config = g.config || jsonb_build_object(
            'version', 1,
            'catalog_url', sc.catalog_url,
            'stac_collection_id', sc.stac_collection_id,
            'is_mpc', COALESCE(sc.catalog_url LIKE '%planetarycomputer.microsoft.com%', false),
            'tiler', sc.tiler,
            'max_cloud_cover', COALESCE(sc.max_cloud_cover, 100),
            'item_sort', 'date_desc',
            'cover_max_cloud_cover', COALESCE(sc.max_cloud_cover, 100),
            'cover_item_sort', 'cloud_cover_asc',
            'visualizations', COALESCE((
                SELECT jsonb_agg(jsonb_build_object('name', v.name, 'viz_params', v.render_params)
                    ORDER BY v.display_order)
                FROM data.collection_viz_configs v WHERE v.collection_id = c.id), '[]'::jsonb),
            'cover_visualizations', '[]'::jsonb,
            'search_query', sc.search_query,
            'cover_search_query', sc.cover_search_query,
            'internal_storage', sc.internal_storage
        )
        FROM data.imagery_collections c
        JOIN data.collection_stac_configs sc ON sc.collection_id = c.id
        WHERE g.config->>'kind' = 'stac' AND c.id = (
            SELECT min(c2.id) FROM data.imagery_collections c2 WHERE c2.generation_series_id = g.id
        )
        """
    )
    op.execute(
        "UPDATE data.imagery_generation_series SET config = config || '{\"version\": 1}'::jsonb "
        "WHERE config->>'kind' = 'planet_scenes'"
    )
