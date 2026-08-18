from collections.abc import Iterable

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from src.annotation.models import Annotation, AnnotationGeometry, AnnotationTask


def delete_orphan_geometries(db: Session, geometry_ids: Iterable[int] | None = None) -> None:
    """Delete geometry rows no longer referenced by any task or annotation.

    Tasks and task-created annotations share geometry rows (an annotation
    submitted on a task points at the task's geometry), so a geometry may only
    go once its last referrer is gone. Callers pass the candidate ids they just
    unlinked; ``None`` sweeps the whole table (campaign deletion).
    """
    # The session runs with autoflush=False; without this the DELETE below
    # would still see the referrers the caller just ORM-deleted.
    db.flush()
    task_ref = select(AnnotationTask.id).where(AnnotationTask.geometry_id == AnnotationGeometry.id)
    annotation_ref = select(Annotation.id).where(Annotation.geometry_id == AnnotationGeometry.id)
    stmt = delete(AnnotationGeometry).where(~task_ref.exists(), ~annotation_ref.exists())
    if geometry_ids is not None:
        stmt = stmt.where(AnnotationGeometry.id.in_(geometry_ids))
    db.execute(stmt)


def delete_rows_and_orphan_geometries(
    db: Session, rows: Iterable[AnnotationTask] | Iterable[Annotation]
) -> None:
    """Delete tasks or annotations together with their newly orphaned geometries."""
    geometry_ids = [row.geometry_id for row in rows]
    for row in rows:
        db.delete(row)
    delete_orphan_geometries(db, geometry_ids)
