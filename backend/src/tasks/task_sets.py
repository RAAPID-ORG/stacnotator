"""Task set management: named groups of annotation tasks within a campaign."""

from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from src.campaigns.models import Campaign
from src.tasks import assignments
from src.tasks.models import Task, TaskSet
from src.tasks.schemas import TaskSetOut
from src.tasks.service import delete_tasks
from src.tasks.summary import task_set_progress

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


def list_task_sets_with_stats(db: Session, campaign: Campaign, viewer_id: UUID) -> list[TaskSetOut]:
    progress = task_set_progress(db, campaign, viewer_id)
    sets = db.scalars(
        select(TaskSet).where(TaskSet.campaign_id == campaign.id).order_by(TaskSet.id)
    )
    return [
        TaskSetOut(id=s.id, name=s.name, created_at=s.created_at, **progress[s.id].model_dump())
        for s in sets
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
    if (num_sets or 0) <= 1:
        raise HTTPException(
            status_code=409,
            detail="A campaign must keep at least one task set",
        )
    tasks = db.scalars(select(Task).where(Task.task_set_id == task_set_id)).all()
    delete_tasks(db, campaign_id, tasks, delete_annotations=False)
    db.delete(task_set)
    db.commit()


def move_tasks_to_set(db: Session, campaign_id: int, task_set_id: int, task_ids: list[int]) -> int:
    require_task_set(db, campaign_id, task_set_id)
    if not task_ids:
        return 0
    found = assignments.verify_tasks_in_campaign(db, campaign_id, task_ids)
    db.execute(
        update(Task)
        .where(Task.id.in_(task_ids))
        .values(task_set_id=task_set_id, changed_at=func.now())
    )
    db.commit()
    return len(found)
