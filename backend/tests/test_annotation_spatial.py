"""The task filter on the spatial reads behind Explore.

The map's tiles, the minimap's density, box selection and fit-to-bounds must
agree on what exists, so each one has to honour ``include_tasks``. The queries
are raw SQL executed against PostGIS; these tests capture the statement a fake
session receives rather than standing up a database.
"""

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
