"""Views reference sources: collection_refs -> source_ids.

A view now stores only which sources it contains (ordered). Whether a
collection appears as a window is expressed solely by membership in the
view's canvas layouts, which already mirrored show_as_window.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "aa4viewsrc"
down_revision: str | Sequence[str] | None = "aa3visinv"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "imagery_views",
        sa.Column("source_ids", JSONB(), server_default="[]", nullable=False),
        schema="data",
    )
    # Ordered dedupe of the source ids referenced by the old refs.
    op.execute(
        """
        UPDATE data.imagery_views v
        SET source_ids = sub.ids
        FROM (
            SELECT id, jsonb_agg(source_id ORDER BY ord) AS ids
            FROM (
                SELECT DISTINCT ON (v2.id, (ref->>'source_id')::int)
                       v2.id, (ref->>'source_id')::int AS source_id, ord
                FROM data.imagery_views v2,
                     jsonb_array_elements(v2.collection_refs) WITH ORDINALITY AS r(ref, ord)
                ORDER BY v2.id, (ref->>'source_id')::int, ord
            ) dedup
            GROUP BY id
        ) sub
        WHERE v.id = sub.id
        """
    )
    op.drop_column("imagery_views", "collection_refs", schema="data")


def downgrade() -> None:
    op.add_column(
        "imagery_views",
        sa.Column("collection_refs", JSONB(), server_default="[]", nullable=False),
        schema="data",
    )
    # Best effort: every collection of each referenced source, window-ness
    # restored from membership in the view's default layout.
    op.execute(
        """
        UPDATE data.imagery_views v
        SET collection_refs = sub.refs
        FROM (
            SELECT v2.id,
                   jsonb_agg(
                       jsonb_build_object(
                           'collection_id', c.id,
                           'source_id', c.source_id,
                           'show_as_window',
                           COALESCE(
                               dl.layout_data @> jsonb_build_array(
                                   jsonb_build_object('i', c.id::text)
                               ),
                               false
                           )
                       ) ORDER BY sid.ord, c.display_order
                   ) AS refs
            FROM data.imagery_views v2
            CROSS JOIN LATERAL jsonb_array_elements_text(v2.source_ids)
                 WITH ORDINALITY AS sid(source_id, ord)
            JOIN data.imagery_collections c ON c.source_id = sid.source_id::int
            LEFT JOIN data.canvas_layouts dl
                 ON dl.view_id = v2.id AND dl.is_default AND dl.user_id IS NULL
            GROUP BY v2.id
        ) sub
        WHERE v.id = sub.id
        """
    )
    op.drop_column("imagery_views", "source_ids", schema="data")
