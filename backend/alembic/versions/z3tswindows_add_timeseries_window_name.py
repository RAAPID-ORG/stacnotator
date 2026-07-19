"""Add window_name to time_series and name the default canvas window.

Every timeseries now belongs to a named canvas window; the default is
"Time series". Existing series (which all shared one unnamed window) are
backfilled to that name, and the historical ``"timeseries"`` grid key in every
stored canvas layout is renamed to the matching ``"timeseries:Time series"`` so
saved window positions carry over without any legacy-key handling in the app.

Revision ID: z3tswindows
Revises: z2formfields
Create Date: 2026-07-18 00:00:00.000000

"""

import json
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "z3tswindows"
down_revision: str | Sequence[str] | None = "z2formfields"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

DEFAULT_WINDOW_NAME = "Time series"
OLD_KEY = "timeseries"
NEW_KEY = f"timeseries:{DEFAULT_WINDOW_NAME}"


def _rename_layout_key(old_key: str, new_key: str) -> None:
    """Rename a grid item key across every stored canvas layout."""
    conn = op.get_bind()
    rows = conn.execute(sa.text("SELECT id, layout_data FROM data.canvas_layouts")).fetchall()
    for row in rows:
        layout = row.layout_data
        if not isinstance(layout, list):
            continue
        changed = False
        for item in layout:
            if isinstance(item, dict) and item.get("i") == old_key:
                item["i"] = new_key
                changed = True
        if changed:
            conn.execute(
                sa.text(
                    "UPDATE data.canvas_layouts SET layout_data = CAST(:d AS jsonb) WHERE id = :id"
                ),
                {"d": json.dumps(layout), "id": row.id},
            )


def upgrade() -> None:
    # NOT NULL with a server default: the new column backfills every existing
    # series to the default window in one step.
    op.add_column(
        "time_series",
        sa.Column("window_name", sa.String(), nullable=False, server_default=DEFAULT_WINDOW_NAME),
        schema="data",
    )
    _rename_layout_key(OLD_KEY, NEW_KEY)


def downgrade() -> None:
    _rename_layout_key(NEW_KEY, OLD_KEY)
    op.drop_column("time_series", "window_name", schema="data")
