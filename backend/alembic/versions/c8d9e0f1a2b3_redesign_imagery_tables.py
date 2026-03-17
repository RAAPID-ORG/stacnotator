"""Redesign imagery tables with data migration

Migrate from old monolithic structure to normalized:
  Old: imagery, imagery_windows, imagery_visualization_url_templates
  New: imagery_sources, visualization_templates, imagery_collections,
       collection_stac_configs, imagery_slices, slice_tile_urls,
       basemaps, imagery_views

Data mapping:
  imagery           -> imagery_sources (1:1, same id)
  imagery_viz_urls   -> visualization_templates (1:1, same id)
  imagery_windows   -> imagery_collections (1:1, same id)
  imagery.stac cols -> collection_stac_configs (1 per collection)
  slicing_interval/unit -> imagery_slices (computed from window date range)
  STAC registration  -> slice_tile_urls (live API calls during migration)
  per old imagery   -> 1 imagery_view (collection_refs from its windows)
  canvas_layouts.imagery_id -> canvas_layouts.view_id

Revision ID: c8d9e0f1a2b3
Revises: b7c9d2e4f6a8
Create Date: 2025-06-08 12:00:00.000000

"""

from __future__ import annotations

import logging
from collections.abc import Sequence
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, timedelta

import sqlalchemy as sa
from dateutil.relativedelta import relativedelta
from sqlalchemy.dialects.postgresql import JSONB

from alembic import op
from src.imagery.stac_registration import register_single_slice, resolve_tile_url

logger = logging.getLogger(__name__)

revision: str = "c8d9e0f1a2b3"
down_revision: str | None = "b7c9d2e4f6a8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SCHEMA = "data"


def _parse_yyyymmdd(s: str) -> date:
    return date(int(s[:4]), int(s[4:6]), int(s[6:8]))


def _add_duration(d: date, interval: int, unit: str) -> date:
    unit_lower = unit.lower()
    if unit_lower in ("week", "weeks"):
        return d + timedelta(weeks=interval)
    if unit_lower in ("month", "months"):
        return d + relativedelta(months=interval)
    if unit_lower in ("year", "years"):
        return d + relativedelta(years=interval)
    return d + timedelta(days=interval)


def _compute_slices(
    window_start: str,
    window_end: str,
    slicing_interval: int | None,
    slicing_unit: str | None,
) -> list[dict]:
    start = _parse_yyyymmdd(window_start)
    end = _parse_yyyymmdd(window_end)

    if not slicing_interval or not slicing_unit:
        return [{"index": 0, "start": start, "end": end}]

    slices: list[dict] = []
    current = start
    idx = 0
    while current < end:
        slice_end = min(_add_duration(current, slicing_interval, slicing_unit), end)
        slices.append({"index": idx, "start": current, "end": slice_end})
        current = slice_end
        idx += 1
    return slices


def upgrade() -> None:
    conn = op.get_bind()

    # ── 1. Create new tables ──

    op.create_table(
        "imagery_sources",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("campaign_id", sa.Integer(), sa.ForeignKey(f"{SCHEMA}.campaigns.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("crosshair_hex6", sa.String(6), server_default="ff0000", nullable=False),
        sa.Column("default_zoom", sa.SmallInteger(), server_default="14", nullable=False),
        sa.CheckConstraint("default_zoom BETWEEN 0 AND 22", name="source_zoom_check"),
        schema=SCHEMA,
    )

    op.create_table(
        "visualization_templates",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("source_id", sa.Integer(), sa.ForeignKey(f"{SCHEMA}.imagery_sources.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("display_order", sa.SmallInteger(), server_default="0", nullable=False),
        schema=SCHEMA,
    )

    op.create_table(
        "imagery_collections",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("source_id", sa.Integer(), sa.ForeignKey(f"{SCHEMA}.imagery_sources.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("cover_slice_index", sa.SmallInteger(), server_default="0", nullable=False),
        sa.Column("display_order", sa.SmallInteger(), server_default="0", nullable=False),
        schema=SCHEMA,
    )

    op.create_table(
        "collection_stac_configs",
        sa.Column("collection_id", sa.Integer(), sa.ForeignKey(f"{SCHEMA}.imagery_collections.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("registration_url", sa.Text(), nullable=False),
        sa.Column("search_body", sa.Text(), nullable=False),
        schema=SCHEMA,
    )

    op.create_table(
        "imagery_slices",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("collection_id", sa.Integer(), sa.ForeignKey(f"{SCHEMA}.imagery_collections.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(), nullable=False, server_default=""),
        sa.Column("start_date", sa.String(10), nullable=False),
        sa.Column("end_date", sa.String(10), nullable=False),
        sa.Column("display_order", sa.SmallInteger(), server_default="0", nullable=False),
        schema=SCHEMA,
    )

    op.create_table(
        "slice_tile_urls",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("slice_id", sa.Integer(), sa.ForeignKey(f"{SCHEMA}.imagery_slices.id", ondelete="CASCADE"), nullable=False),
        sa.Column("visualization_name", sa.String(), nullable=False),
        sa.Column("tile_url", sa.Text(), nullable=False),
        schema=SCHEMA,
    )

    op.create_table(
        "basemaps",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("campaign_id", sa.Integer(), sa.ForeignKey(f"{SCHEMA}.campaigns.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("url", sa.Text(), nullable=False),
        schema=SCHEMA,
    )

    op.create_table(
        "imagery_views",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("campaign_id", sa.Integer(), sa.ForeignKey(f"{SCHEMA}.campaigns.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(), nullable=False, server_default=""),
        sa.Column("display_order", sa.SmallInteger(), server_default="0", nullable=False),
        sa.Column("collection_refs", JSONB(), server_default="[]", nullable=False),
        schema=SCHEMA,
    )

    # ── 2. Migrate data ──

    # imagery -> imagery_sources (preserve id)
    conn.execute(sa.text("""
        INSERT INTO data.imagery_sources (id, campaign_id, name, crosshair_hex6, default_zoom)
        SELECT id, campaign_id, name,
               COALESCE(crosshair_hex6, 'ff0000'),
               COALESCE(default_zoom, 14)
        FROM data.imagery
    """))

    # imagery_visualization_url_templates -> visualization_templates (preserve id)
    conn.execute(sa.text("""
        INSERT INTO data.visualization_templates (id, source_id, name, display_order)
        SELECT id, imagery_id, name, 0
        FROM data.imagery_visualization_url_templates
    """))

    # imagery_windows -> imagery_collections (preserve id, window_index -> display_order)
    conn.execute(sa.text("""
        INSERT INTO data.imagery_collections (id, source_id, name, cover_slice_index, display_order)
        SELECT w.id, w.imagery_id,
               i.name || ' #' || w.window_index,
               0, w.window_index
        FROM data.imagery_windows w
        JOIN data.imagery i ON i.id = w.imagery_id
    """))

    # collection_stac_configs: one per collection, inheriting from parent imagery
    conn.execute(sa.text("""
        INSERT INTO data.collection_stac_configs (collection_id, registration_url, search_body)
        SELECT w.id, i.registration_url, i.search_body::text
        FROM data.imagery_windows w
        JOIN data.imagery i ON i.id = w.imagery_id
        WHERE i.registration_url IS NOT NULL AND i.registration_url != ''
    """))

    # ── 2b. Compute slices from slicing_interval/unit and register STAC ──

    imagery_rows = conn.execute(sa.text("""
        SELECT i.id, i.slicing_interval, i.slicing_unit,
               i.registration_url, i.search_body::text as search_body,
               s.bbox_west, s.bbox_south, s.bbox_east, s.bbox_north
        FROM data.imagery i
        JOIN data.settings s ON s.campaign_id = i.campaign_id
    """)).fetchall()

    imagery_lookup = {
        r.id: {
            "slicing_interval": r.slicing_interval,
            "slicing_unit": r.slicing_unit,
            "registration_url": r.registration_url,
            "search_body": r.search_body,
            "bbox": [r.bbox_west, r.bbox_south, r.bbox_east, r.bbox_north],
        }
        for r in imagery_rows
    }

    viz_rows = conn.execute(sa.text("""
        SELECT imagery_id, name, visualization_url
        FROM data.imagery_visualization_url_templates
        ORDER BY imagery_id, id
    """)).fetchall()

    viz_lookup: dict[int, list[dict]] = {}
    for r in viz_rows:
        viz_lookup.setdefault(r.imagery_id, []).append(
            {"name": r.name, "url_template": r.visualization_url},
        )

    window_rows = conn.execute(sa.text("""
        SELECT id, imagery_id, window_start_date, window_end_date, window_index
        FROM data.imagery_windows
        ORDER BY imagery_id, window_index
    """)).fetchall()

    # Phase 1: insert all slices into DB (serial) and collect STAC tasks
    slice_insert = sa.text("""
        INSERT INTO data.imagery_slices (collection_id, name, start_date, end_date, display_order)
        VALUES (:coll_id, :name, :start, :end, :display_order)
        RETURNING id
    """)

    stac_tasks: list[dict] = []

    for window in window_rows:
        img = imagery_lookup.get(window.imagery_id)
        if not img:
            continue

        slices = _compute_slices(
            window.window_start_date,
            window.window_end_date,
            img["slicing_interval"],
            img["slicing_unit"],
        )

        viz_templates = viz_lookup.get(window.imagery_id, [])
        has_stac = bool(img["registration_url"] and img["search_body"] and viz_templates)

        for sl in slices:
            start_str = sl["start"].isoformat()
            end_str = sl["end"].isoformat()

            row = conn.execute(slice_insert, {
                "coll_id": window.id,
                "name": "",
                "start": start_str,
                "end": end_str,
                "display_order": sl["index"],
            }).fetchone()
            slice_id = row[0]

            if has_stac:
                stac_tasks.append({
                    "slice_id": slice_id,
                    "collection_id": window.id,
                    "registration_url": img["registration_url"],
                    "search_body": img["search_body"],
                    "bbox": img["bbox"],
                    "start": start_str,
                    "end": end_str,
                    "viz_templates": viz_templates,
                })

    print(f"  Inserted slices into DB, launching {len(stac_tasks)} STAC registrations…")  # noqa: T201

    # Phase 2: parallel HTTP registrations (no DB interaction)
    def _do_register(task: dict) -> dict | None:
        try:
            search_id = register_single_slice(
                task["registration_url"],
                task["search_body"],
                task["bbox"],
                task["start"],
                task["end"],
            )
            return {
                "slice_id": task["slice_id"],
                "tile_urls": [
                    {"viz_name": vt["name"], "tile_url": resolve_tile_url(vt["url_template"], search_id)}
                    for vt in task["viz_templates"]
                ],
            }
        except Exception:
            logger.warning(
                "STAC registration failed for slice %s (collection %s, %s→%s)",
                task["slice_id"], task["collection_id"], task["start"], task["end"],
                exc_info=True,
            )
            return None

    registration_results: list[dict] = []
    total = len(stac_tasks)
    done = 0
    failed = 0
    with ThreadPoolExecutor(max_workers=8) as pool:
        futures = {pool.submit(_do_register, t): t for t in stac_tasks}
        for future in as_completed(futures):
            done += 1
            result = future.result()
            if result:
                registration_results.append(result)
            else:
                failed += 1
            if done % 50 == 0 or done == total:
                print(f"  STAC registration progress: {done}/{total} ({failed} failed)")  # noqa: T201

    # Phase 3: batch-insert resolved tile URLs (serial DB writes)
    tile_insert = sa.text("""
        INSERT INTO data.slice_tile_urls (slice_id, visualization_name, tile_url)
        VALUES (:slice_id, :viz_name, :tile_url)
    """)
    for result in registration_results:
        for tu in result["tile_urls"]:
            conn.execute(tile_insert, {
                "slice_id": result["slice_id"],
                "viz_name": tu["viz_name"],
                "tile_url": tu["tile_url"],
            })

    failed = total - len(registration_results)
    print(f"  STAC registration complete: {len(registration_results)}/{total} OK, {failed} failed")  # noqa: T201

    # imagery_views: one view per old imagery row
    conn.execute(sa.text("""
        INSERT INTO data.imagery_views (id, campaign_id, name, display_order, collection_refs)
        SELECT i.id, i.campaign_id, i.name, 0,
               COALESCE(
                   (SELECT jsonb_agg(
                       jsonb_build_object(
                           'collection_id', w.id,
                           'source_id', w.imagery_id,
                           'show_as_window', true
                       ) ORDER BY w.window_index
                   )
                   FROM data.imagery_windows w
                   WHERE w.imagery_id = i.id),
                   '[]'::jsonb
               )
        FROM data.imagery i
    """))

    # Sync sequences
    conn.execute(sa.text("SELECT setval(pg_get_serial_sequence('data.imagery_sources', 'id'), COALESCE((SELECT MAX(id) FROM data.imagery_sources), 1))"))
    conn.execute(sa.text("SELECT setval(pg_get_serial_sequence('data.visualization_templates', 'id'), COALESCE((SELECT MAX(id) FROM data.visualization_templates), 1))"))
    conn.execute(sa.text("SELECT setval(pg_get_serial_sequence('data.imagery_collections', 'id'), COALESCE((SELECT MAX(id) FROM data.imagery_collections), 1))"))
    conn.execute(sa.text("SELECT setval(pg_get_serial_sequence('data.imagery_slices', 'id'), COALESCE((SELECT MAX(id) FROM data.imagery_slices), 1))"))
    conn.execute(sa.text("SELECT setval(pg_get_serial_sequence('data.slice_tile_urls', 'id'), COALESCE((SELECT MAX(id) FROM data.slice_tile_urls), 1))"))
    conn.execute(sa.text("SELECT setval(pg_get_serial_sequence('data.imagery_views', 'id'), COALESCE((SELECT MAX(id) FROM data.imagery_views), 1))"))

    # ── 3. Swap canvas_layouts FK: imagery_id -> view_id ──

    op.add_column("canvas_layouts", sa.Column("view_id", sa.Integer(), nullable=True), schema=SCHEMA)

    conn.execute(sa.text("""
        UPDATE data.canvas_layouts
        SET view_id = imagery_id
        WHERE imagery_id IS NOT NULL
    """))

    op.create_foreign_key(
        "canvas_layouts_view_id_fkey", "canvas_layouts", "imagery_views",
        ["view_id"], ["id"],
        source_schema=SCHEMA, referent_schema=SCHEMA, ondelete="CASCADE",
    )

    op.drop_constraint("canvas_layouts_imagery_id_fkey", "canvas_layouts", schema=SCHEMA, type_="foreignkey")
    op.drop_column("canvas_layouts", "imagery_id", schema=SCHEMA)

    # ── 4. Drop old tables ──

    op.drop_table("imagery_visualization_url_templates", schema=SCHEMA)
    op.drop_table("imagery_windows", schema=SCHEMA)
    op.drop_table("imagery", schema=SCHEMA)


def downgrade() -> None:
    conn = op.get_bind()

    # ── 1. Recreate old tables ──

    op.create_table(
        "imagery",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("campaign_id", sa.Integer(), sa.ForeignKey(f"{SCHEMA}.campaigns.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("start_ym", sa.String(6), nullable=False),
        sa.Column("end_ym", sa.String(6), nullable=False),
        sa.Column("crosshair_hex6", sa.String(6), nullable=True),
        sa.Column("default_zoom", sa.Integer(), nullable=True),
        sa.Column("window_interval", sa.Integer(), nullable=True),
        sa.Column("window_unit", sa.String(20), nullable=True),
        sa.Column("slicing_interval", sa.Integer(), nullable=True),
        sa.Column("slicing_unit", sa.String(20), nullable=True),
        sa.Column("registration_url", sa.Text(), nullable=True),
        sa.Column("search_body", JSONB(), nullable=True),
        sa.Column("default_main_window_id", sa.Integer(), nullable=True),
        schema=SCHEMA,
    )

    op.create_table(
        "imagery_windows",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("imagery_id", sa.Integer(), sa.ForeignKey(f"{SCHEMA}.imagery.id", ondelete="CASCADE"), nullable=False),
        sa.Column("window_start_date", sa.String(10), nullable=False),
        sa.Column("window_end_date", sa.String(10), nullable=False),
        sa.Column("window_index", sa.Integer(), nullable=False),
        schema=SCHEMA,
    )

    op.create_table(
        "imagery_visualization_url_templates",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("imagery_id", sa.Integer(), sa.ForeignKey(f"{SCHEMA}.imagery.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("visualization_url", sa.Text(), nullable=False),
        schema=SCHEMA,
    )

    # ── 2. Migrate data back ──

    # imagery_sources -> imagery (best-effort: columns not in new schema get defaults)
    conn.execute(sa.text("""
        INSERT INTO data.imagery (id, campaign_id, name, start_ym, end_ym, crosshair_hex6, default_zoom,
                                  registration_url)
        SELECT s.id, s.campaign_id, s.name, '000000', '000000', s.crosshair_hex6, s.default_zoom,
               (SELECT csc.registration_url FROM data.collection_stac_configs csc
                JOIN data.imagery_collections ic ON ic.id = csc.collection_id
                WHERE ic.source_id = s.id LIMIT 1)
        FROM data.imagery_sources s
    """))

    # imagery_collections -> imagery_windows
    conn.execute(sa.text("""
        INSERT INTO data.imagery_windows (id, imagery_id, window_start_date, window_end_date, window_index)
        SELECT ic.id, ic.source_id,
               COALESCE(
                   (SELECT replace(sl.start_date, '-', '') FROM data.imagery_slices sl WHERE sl.collection_id = ic.id ORDER BY sl.display_order LIMIT 1),
                   '00000000'
               ),
               COALESCE(
                   (SELECT replace(sl.end_date, '-', '') FROM data.imagery_slices sl WHERE sl.collection_id = ic.id ORDER BY sl.display_order DESC LIMIT 1),
                   '00000000'
               ),
               ic.display_order
        FROM data.imagery_collections ic
    """))

    # visualization_templates -> imagery_visualization_url_templates (no URL stored in new schema)
    conn.execute(sa.text("""
        INSERT INTO data.imagery_visualization_url_templates (id, imagery_id, name, visualization_url)
        SELECT id, source_id, name, ''
        FROM data.visualization_templates
    """))

    # Sync sequences
    conn.execute(sa.text("SELECT setval(pg_get_serial_sequence('data.imagery', 'id'), COALESCE((SELECT MAX(id) FROM data.imagery), 1))"))
    conn.execute(sa.text("SELECT setval(pg_get_serial_sequence('data.imagery_windows', 'id'), COALESCE((SELECT MAX(id) FROM data.imagery_windows), 1))"))
    conn.execute(sa.text("SELECT setval(pg_get_serial_sequence('data.imagery_visualization_url_templates', 'id'), COALESCE((SELECT MAX(id) FROM data.imagery_visualization_url_templates), 1))"))

    # ── 3. Swap canvas_layouts FK back: view_id -> imagery_id ──

    op.add_column("canvas_layouts", sa.Column("imagery_id", sa.Integer(), nullable=True), schema=SCHEMA)

    conn.execute(sa.text("""
        UPDATE data.canvas_layouts
        SET imagery_id = view_id
        WHERE view_id IS NOT NULL
    """))

    op.create_foreign_key(
        "canvas_layouts_imagery_id_fkey", "canvas_layouts", "imagery",
        ["imagery_id"], ["id"],
        source_schema=SCHEMA, referent_schema=SCHEMA, ondelete="CASCADE",
    )

    op.drop_constraint("canvas_layouts_view_id_fkey", "canvas_layouts", schema=SCHEMA, type_="foreignkey")
    op.drop_column("canvas_layouts", "view_id", schema=SCHEMA)

    # ── 4. Drop new tables ──

    op.drop_table("imagery_views", schema=SCHEMA)
    op.drop_table("basemaps", schema=SCHEMA)
    op.drop_table("slice_tile_urls", schema=SCHEMA)
    op.drop_table("imagery_slices", schema=SCHEMA)
    op.drop_table("collection_stac_configs", schema=SCHEMA)
    op.drop_table("imagery_collections", schema=SCHEMA)
    op.drop_table("visualization_templates", schema=SCHEMA)
    op.drop_table("imagery_sources", schema=SCHEMA)
