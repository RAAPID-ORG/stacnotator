"""The task filter on the spatial reads behind Explore.

The map's tiles, the minimap's density, box selection and fit-to-bounds must
agree on what exists, so each one has to honour ``include_tasks``. The queries
are raw SQL executed against PostGIS; these tests capture the statement a fake
session receives rather than standing up a database.
"""

from datetime import UTC, datetime
from unittest.mock import MagicMock

import pytest

from src.annotation import spatial
from src.annotation.tiles import TASK_ANNOTATION_EXCLUSION


def _session(rows):
    db = MagicMock()
    result = db.execute.return_value
    result.scalars.return_value = rows
    result.all.return_value = rows
    result.first.return_value = rows[0] if rows else None
    return db


def _sql_of(db) -> str:
    return str(db.execute.call_args.args[0])


def _bbox_ids(db, include_tasks):
    return spatial.get_annotation_ids_in_bbox(
        db, 1, -1.0, -1.0, 1.0, 1.0, include_tasks=include_tasks
    )


def _extent(db, include_tasks):
    return spatial.get_campaign_annotations_extent(db, 1, include_tasks=include_tasks)


def _density(db, include_tasks):
    return spatial.get_annotation_density(db, 1, include_tasks=include_tasks)


@pytest.mark.parametrize(
    "read, rows",
    [
        (_bbox_ids, [1, 2]),
        (_extent, [(0.0, 0.0, 1.0, 1.0)]),
        (_density, [(0.0, 0.0, 1.0, 1.0)]),
    ],
)
def test_spatial_reads_include_task_annotations_by_default(read, rows):
    db = _session(rows)
    read(db, True)
    assert "annotation_task_id" not in _sql_of(db)


@pytest.mark.parametrize(
    "read, rows",
    [
        (_bbox_ids, [1, 2]),
        (_extent, [(0.0, 0.0, 1.0, 1.0)]),
        (_density, [(0.0, 0.0, 1.0, 1.0)]),
    ],
)
def test_spatial_reads_can_leave_out_task_annotations(read, rows):
    db = _session(rows)
    read(db, False)
    assert TASK_ANNOTATION_EXCLUSION in _sql_of(db)


def test_density_reports_where_the_annotations_are_not_the_cell_centre():
    """The grid only groups. Reporting the cell's own centre would put a
    minimap dot up to half a cell (hundreds of metres) away from the
    annotations it stands for."""
    db = _session([(0.0, 0.0, 1.0, 1.0)])
    _density(db, True)
    sql = _sql_of(db)
    assert "avg(ST_X(c))" in sql
    assert "avg(ST_Y(c))" in sql
    assert "GROUP BY floor(ST_X(c)" in sql


# ---------------------------------------------------------------------------
# The poll that lets one annotator see another's work
# ---------------------------------------------------------------------------


def _changes_session(rows):
    db = MagicMock()
    db.execute.return_value.mappings.return_value = rows
    return db


def _change_row(annotation_id: int):
    return {
        "id": annotation_id,
        "label_id": 1,
        "created_by_user_id": "11111111-1111-1111-1111-111111111111",
        "geometry_wkt": "POINT(1 2)",
    }


CURSOR = datetime(2026, 8, 19, 10, 0, tzinfo=UTC)


def test_changes_honour_the_task_filter():
    db = _changes_session([_change_row(1)])
    spatial.get_annotation_changes(db, 1, CURSOR, include_tasks=False)
    assert TASK_ANNOTATION_EXCLUSION in _sql_of(db)


def test_changes_look_back_past_the_cursor():
    """A row is stamped when its transaction runs, not when it commits, so a
    poll taken between the two would never see it again."""
    db = _changes_session([])
    spatial.get_annotation_changes(db, 1, CURSOR)
    assert db.execute.call_args.args[1]["since"] < CURSOR


def test_a_cursor_without_an_offset_is_read_as_utc():
    """Not as the database session's local time, which would be hours of
    annotations either way."""
    db = _changes_session([])
    spatial.get_annotation_changes(db, 1, CURSOR.replace(tzinfo=None))
    assert db.execute.call_args.args[1]["since"].tzinfo is UTC


def test_changes_report_more_waiting_than_the_limit():
    db = _changes_session([_change_row(i) for i in range(3)])
    changes, truncated = spatial.get_annotation_changes(db, 1, CURSOR, limit=2)

    assert truncated
    assert [c["id"] for c in changes] == [0, 1]


def test_changes_carry_what_the_map_needs_to_draw_one():
    db = _changes_session([_change_row(7)])
    changes, truncated = spatial.get_annotation_changes(db, 1, CURSOR)

    assert not truncated
    assert changes == [
        {
            "id": 7,
            "label_id": 1,
            "created_by_user_id": "11111111-1111-1111-1111-111111111111",
            "geometry_wkt": "POINT(1 2)",
        }
    ]
