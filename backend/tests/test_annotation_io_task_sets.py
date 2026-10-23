"""Task ingest stamps every created task with the target task set."""

from types import SimpleNamespace
from unittest.mock import MagicMock

from src.tasks import ingest

# Imported for its side effect of registering the ORM mapper; ingest.py's insert()
# calls need Task's table metadata available.
from src.tasks.models import Task  # noqa: F401

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


CAMPAIGN = SimpleNamespace(id=1, embedding_year=None)


def test_csv_ingest_stamps_task_set_id():
    db = MagicMock()
    ingest.create_annotation_tasks_from_csv(db, CAMPAIGN, contents=CSV, task_set_id=7)
    records = _inserted_task_records(db)
    assert all(r["task_set_id"] == 7 for r in records)
    assert [r["annotation_number"] for r in records] == [1, 2]


def test_geojson_ingest_stamps_task_set_id():
    db = MagicMock()
    db.scalar.return_value = 0  # current max annotation_number
    ingest.create_annotation_tasks_from_geojson(db, CAMPAIGN, contents=GEOJSON, task_set_id=7)
    records = _inserted_task_records(db)
    assert all(r["task_set_id"] == 7 for r in records)
    assert isinstance(records[0], dict) or hasattr(records[0], "keys")
