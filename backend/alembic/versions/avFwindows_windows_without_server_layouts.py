"""Windows follow the campaign; layouts only place and hide them

Time-series windows were a name shared by series and the layout key, so renaming one
rewrote every main layout; they become rows of their own, keyed in layouts by id. A
view's sources were an id list in JSON with nothing to keep it true when a source was
deleted; they become view_sources rows. And which windows a layout showed was its
membership, so the server packed new windows into every layout on each imagery or
time-series change: a layout now lists the windows it hides, and the client places
any window it neither places nor hides. This migration hides exactly the windows each
layout did not show, so nobody's workspace changes. A layout_data that is not an array
(the column's old '{}' default) is read as an empty layout, which is what it meant.

Revision ID: avFwindows
Revises: avEinline
Create Date: 2026-10-24
"""

import json
from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

from alembic import op

revision: str = "avFwindows"
down_revision: str | Sequence[str] | None = "avEinline"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

DEFAULT_WINDOW = "Time series"
PREFIX = "timeseries:"


def _rekey_main_layouts(conn, campaign_id: int, key_of: dict[str, str]) -> None:
    rows = conn.execute(
        sa.text(
            "SELECT id, layout_data FROM data.canvas_layouts "
            "WHERE campaign_id = :c AND view_id IS NULL"
        ),
        {"c": campaign_id},
    ).all()
    for layout_id, items in rows:
        rekeyed = [
            {**item, "i": key_of[item["i"]]} if item.get("i") in key_of else item
            for item in items or []
            if not str(item.get("i", "")).startswith(PREFIX) or item.get("i") in key_of
        ]
        if rekeyed != items:
            conn.execute(
                sa.text("UPDATE data.canvas_layouts SET layout_data = :d WHERE id = :id"),
                {"d": json.dumps(rekeyed), "id": layout_id},
            )


def upgrade() -> None:
    conn = op.get_bind()

    op.execute(
        "UPDATE data.canvas_layouts SET layout_data = '[]' "
        "WHERE jsonb_typeof(layout_data) IS DISTINCT FROM 'array'"
    )
    op.alter_column(
        "canvas_layouts", "layout_data", server_default=sa.text("'[]'::jsonb"), schema="data"
    )

    op.create_table(
        "timeseries_windows",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "campaign_id",
            sa.Integer(),
            sa.ForeignKey("data.campaigns.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(), nullable=False),
        sa.UniqueConstraint("campaign_id", "name", name="uq_timeseries_windows_campaign_name"),
        schema="data",
    )
    op.execute(
        """
        INSERT INTO data.timeseries_windows (campaign_id, name)
        SELECT campaign_id, name
        FROM (
            SELECT campaign_id, COALESCE(NULLIF(btrim(window_name), ''), 'Time series') AS name,
                   min(id) AS first_id
            FROM data.time_series GROUP BY 1, 2
        ) w
        """
    )
    op.add_column("time_series", sa.Column("window_id", sa.Integer(), nullable=True), schema="data")
    op.execute(
        """
        UPDATE data.time_series t SET window_id = w.id
        FROM data.timeseries_windows w
        WHERE w.campaign_id = t.campaign_id
          AND w.name = COALESCE(NULLIF(btrim(t.window_name), ''), 'Time series')
        """
    )
    op.alter_column("time_series", "window_id", nullable=False, schema="data")
    op.create_foreign_key(
        "time_series_window_id_fkey",
        "time_series",
        "timeseries_windows",
        ["window_id"],
        ["id"],
        source_schema="data",
        referent_schema="data",
        ondelete="CASCADE",
    )
    op.create_index("idx_time_series_window_id", "time_series", ["window_id"], schema="data")
    op.drop_column("time_series", "window_name", schema="data")

    by_campaign: dict[int, dict[str, str]] = {}
    for window_id, campaign_id, name in conn.execute(
        sa.text("SELECT id, campaign_id, name FROM data.timeseries_windows")
    ):
        by_campaign.setdefault(campaign_id, {})[f"{PREFIX}{name}"] = f"{PREFIX}{window_id}"
    for (campaign_id,) in conn.execute(sa.text("SELECT id FROM data.campaigns")).all():
        _rekey_main_layouts(conn, campaign_id, by_campaign.get(campaign_id, {}))

    op.create_table(
        "view_sources",
        sa.Column(
            "view_id",
            sa.Integer(),
            sa.ForeignKey("data.imagery_views.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "source_id",
            sa.Integer(),
            sa.ForeignKey("data.imagery_sources.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("position", sa.SmallInteger(), nullable=False),
        schema="data",
    )
    op.create_index("idx_view_sources_source_id", "view_sources", ["source_id"], schema="data")
    op.execute(
        """
        INSERT INTO data.view_sources (view_id, source_id, position)
        SELECT DISTINCT ON (v.id, e.value::int) v.id, e.value::int, (e.ordinality - 1)::smallint
        FROM data.imagery_views v
        CROSS JOIN LATERAL jsonb_array_elements_text(v.source_ids) WITH ORDINALITY e
        JOIN data.imagery_sources s ON s.id = e.value::int
        ORDER BY v.id, e.value::int, e.ordinality
        """
    )
    op.drop_column("imagery_views", "source_ids", schema="data")

    op.add_column(
        "canvas_layouts",
        sa.Column("hidden", JSONB(), server_default="[]", nullable=False),
        schema="data",
    )
    # A view's layout showed what it listed; every other collection of the view is hidden.
    op.execute(
        """
        UPDATE data.canvas_layouts l SET hidden = COALESCE((
            SELECT jsonb_agg(c.id::text ORDER BY c.id)
            FROM data.view_sources vs
            JOIN data.imagery_collections c ON c.source_id = vs.source_id
            WHERE vs.view_id = l.view_id
              AND NOT EXISTS (
                SELECT 1 FROM jsonb_array_elements(l.layout_data) item
                WHERE item->>'i' = c.id::text
              )
        ), '[]'::jsonb)
        WHERE l.view_id IS NOT NULL
        """
    )


def downgrade() -> None:
    conn = op.get_bind()

    # Membership was the layout's items again: what a layout did not place, it hid.
    op.drop_column("canvas_layouts", "hidden", schema="data")

    op.add_column(
        "imagery_views",
        sa.Column("source_ids", JSONB(), server_default="[]", nullable=False),
        schema="data",
    )
    op.execute(
        """
        UPDATE data.imagery_views v SET source_ids = COALESCE((
            SELECT jsonb_agg(vs.source_id ORDER BY vs.position)
            FROM data.view_sources vs WHERE vs.view_id = v.id
        ), '[]'::jsonb)
        """
    )
    op.drop_table("view_sources", schema="data")

    op.add_column(
        "time_series",
        sa.Column("window_name", sa.String(), server_default=DEFAULT_WINDOW, nullable=False),
        schema="data",
    )
    op.execute(
        """
        UPDATE data.time_series t SET window_name = w.name
        FROM data.timeseries_windows w WHERE w.id = t.window_id
        """
    )
    by_campaign: dict[int, dict[str, str]] = {}
    for window_id, campaign_id, name in conn.execute(
        sa.text("SELECT id, campaign_id, name FROM data.timeseries_windows")
    ):
        by_campaign.setdefault(campaign_id, {})[f"{PREFIX}{window_id}"] = f"{PREFIX}{name}"
    for (campaign_id,) in conn.execute(sa.text("SELECT id FROM data.campaigns")).all():
        _rekey_main_layouts(conn, campaign_id, by_campaign.get(campaign_id, {}))
    op.drop_index("idx_time_series_window_id", "time_series", schema="data")
    op.drop_column("time_series", "window_id", schema="data")
    op.drop_table("timeseries_windows", schema="data")
