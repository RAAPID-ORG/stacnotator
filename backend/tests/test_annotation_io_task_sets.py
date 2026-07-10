"""Task ingest stamps every created task with the target task set."""

from unittest.mock import MagicMock

from src.annotation import io as annotation_io

# Imported for its side effect of registering the ORM mapper; io.py's insert()
# calls need AnnotationTask's table metadata available.
from src.annotation.models import AnnotationTask  # noqa: F401

CSV = b"id,lat,lon\n1,10.0,20.0\n2,11.0,21.0\n"
GEOJSON = (
    b'{"type": "FeatureCollection", "features": ['
    b'{"type": "Feature", "geometry": {"type": "Point", "coordinates": [20.0, 10.0]},'
    b' "properties": {"plot": "a"}}]}'
)


def _inserted_task_records(db):
    for call in db.execute.call_args_list:
        stmt = call.args[0]
        if getattr(getattr(stmt, "table", None), "name", None) == "annotation_tasks":
            return call.args[1]
    raise AssertionError("no insert into annotation_tasks")


def _db_with_geometry_ids(ids):
    db = MagicMock()
    rows = [MagicMock(id=i) for i in ids]
    db.execute.return_value.__iter__ = lambda self: iter(rows)
    return db


def test_csv_ingest_stamps_task_set_id():
    db = _db_with_geometry_ids([101, 102])
    annotation_io.create_annotation_tasks_from_csv(db, campaign_id=1, contents=CSV, task_set_id=7)
    records = _inserted_task_records(db)
    assert all(r["task_set_id"] == 7 for r in records)


def test_geojson_ingest_stamps_task_set_id():
    db = _db_with_geometry_ids([101])
    db.scalar.return_value = 0  # current max annotation_number
    annotation_io.create_annotation_tasks_from_geojson(
        db, campaign_id=1, contents=GEOJSON, task_set_id=7
    )
    records = _inserted_task_records(db)
    assert all(r["task_set_id"] == 7 for r in records)
    assert isinstance(records[0], dict) or hasattr(records[0], "keys")
