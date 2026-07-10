"""Task set management: named groups of annotation tasks within a campaign."""

from fastapi import HTTPException
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from src.annotation.models import Annotation, AnnotationTask
from src.campaigns.models import TaskSet

DEFAULT_TASK_SET_NAME = "Default"


def require_task_set(
    db: Session, campaign_id: int, task_set_id: int, status_code: int = 404
) -> TaskSet:
    task_set = db.get(TaskSet, task_set_id)
    if task_set is None or task_set.campaign_id != campaign_id:
        raise HTTPException(
            status_code=status_code,
            detail=f"Task set {task_set_id} not found in this campaign",
        )
    return task_set


def _require_free_name(db: Session, campaign_id: int, name: str) -> None:
    existing = db.scalar(
        select(TaskSet).where(TaskSet.campaign_id == campaign_id, TaskSet.name == name)
    )
    if existing is not None:
        raise HTTPException(
            status_code=409,
            detail=f"A task set named '{name}' already exists in this campaign",
        )


def list_task_sets_with_stats(db: Session, campaign_id: int) -> list[dict]:
    rows = db.execute(
        select(
            TaskSet.id,
            TaskSet.name,
            TaskSet.created_at,
            func.count(func.distinct(AnnotationTask.id)).label("num_tasks"),
            func.count(func.distinct(Annotation.annotation_task_id)).label("num_labeled"),
        )
        .select_from(TaskSet)
        .outerjoin(AnnotationTask, AnnotationTask.task_set_id == TaskSet.id)
        .outerjoin(Annotation, Annotation.annotation_task_id == AnnotationTask.id)
        .where(TaskSet.campaign_id == campaign_id)
        .group_by(TaskSet.id, TaskSet.name, TaskSet.created_at)
        .order_by(TaskSet.id)
    ).all()
    return [
        {
            "id": row.id,
            "name": row.name,
            "created_at": row.created_at,
            "num_tasks": row.num_tasks,
            "num_labeled": row.num_labeled,
        }
        for row in rows
    ]


def create_task_set(db: Session, campaign_id: int, name: str) -> TaskSet:
    _require_free_name(db, campaign_id, name)
    task_set = TaskSet(campaign_id=campaign_id, name=name)
    db.add(task_set)
    db.commit()
    db.refresh(task_set)
    return task_set


def rename_task_set(db: Session, campaign_id: int, task_set_id: int, name: str) -> TaskSet:
    task_set = require_task_set(db, campaign_id, task_set_id)
    if task_set.name != name:
        _require_free_name(db, campaign_id, name)
        task_set.name = name
        db.commit()
        db.refresh(task_set)
    return task_set


def delete_task_set(db: Session, campaign_id: int, task_set_id: int) -> None:
    task_set = require_task_set(db, campaign_id, task_set_id)
    num_sets = db.scalar(
        select(func.count()).select_from(TaskSet).where(TaskSet.campaign_id == campaign_id)
    )
    if num_sets <= 1:
        raise HTTPException(
            status_code=409,
            detail="A campaign must keep at least one task set",
        )
    tasks = db.scalars(
        select(AnnotationTask).where(AnnotationTask.task_set_id == task_set_id)
    ).all()
    for task in tasks:
        db.delete(task)
    db.delete(task_set)
    db.commit()


def move_tasks_to_set(db: Session, campaign_id: int, task_set_id: int, task_ids: list[int]) -> int:
    require_task_set(db, campaign_id, task_set_id)
    if not task_ids:
        return 0
    found = set(
        db.scalars(
            select(AnnotationTask.id).where(
                AnnotationTask.id.in_(task_ids),
                AnnotationTask.campaign_id == campaign_id,
            )
        ).all()
    )
    missing = set(task_ids) - found
    if missing:
        raise HTTPException(
            status_code=404,
            detail=(f"Tasks not found in campaign: {', '.join(str(t) for t in sorted(missing))}"),
        )
    db.execute(
        update(AnnotationTask)
        .where(AnnotationTask.id.in_(task_ids))
        .values(task_set_id=task_set_id)
    )
    db.commit()
    return len(found)
