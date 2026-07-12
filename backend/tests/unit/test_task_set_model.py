"""TaskSet model registration and schema wiring (DB-free)."""

from src.annotation.models import AnnotationTask
from src.campaigns.models import TaskSet


def test_task_set_table_definition():
    assert TaskSet.__table__.schema == "data"
    assert TaskSet.__table__.name == "task_sets"
    unique = [
        c for c in TaskSet.__table__.constraints if c.__class__.__name__ == "UniqueConstraint"
    ]
    assert any({col.name for col in c.columns} == {"campaign_id", "name"} for c in unique)


def test_annotation_task_references_task_set():
    col = AnnotationTask.__table__.c.task_set_id
    assert col.nullable is False
    fk = next(iter(col.foreign_keys))
    assert fk.target_fullname == "data.task_sets.id"
    assert fk.ondelete == "CASCADE"
