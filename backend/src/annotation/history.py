import json
from datetime import timedelta
from uuid import UUID

from fastapi import Depends, Header, HTTPException, Response
from fastapi.encoders import jsonable_encoder
from geoalchemy2.shape import to_shape
from sqlalchemy import delete, func, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from src.annotation.models import Annotation, AnnotationAction, DeletedAnnotation
from src.annotation.sync import (
    bump_campaign_annotations_version,
    record_annotation_deletions,
    touch_tasks,
)
from src.campaigns.models import Campaign
from src.database import get_db

HISTORY_HEADER = "X-Annotation-History"
ACTION_HEADER = "X-Annotation-Action"
RETENTION = timedelta(days=1)


def track_history(
    response: Response,
    enabled: bool = Header(False, alias=HISTORY_HEADER),
    db: Session = Depends(get_db),
) -> None:
    if enabled:
        db.info["annotation_history_response"] = response


def snapshot(annotation: Annotation) -> dict:
    values = {
        column.name: getattr(annotation, column.name) for column in Annotation.__table__.columns
    }
    values["geometry"] = to_shape(annotation.geometry).wkb_hex
    encoded: dict = jsonable_encoder(values)
    return encoded


def capture(db: Session, annotations: list[Annotation]) -> list[dict] | None:
    if not isinstance(db.info.get("annotation_history_response"), Response):
        return None
    return [snapshot(annotation) for annotation in annotations]


def record(
    db: Session,
    campaign_id: int,
    user_id: UUID,
    before: list[dict] | None,
    annotations: list[Annotation],
) -> None:
    if before is None:
        return
    db.flush()
    after = [snapshot(annotation) for annotation in annotations]
    if comparable(before) == comparable(after):
        return
    action = AnnotationAction(campaign_id=campaign_id, user_id=user_id, before=before, after=after)
    db.add(action)
    db.execute(delete(AnnotationAction).where(AnnotationAction.created_at < func.now() - RETENTION))
    db.flush()
    db.info["annotation_history_response"].headers[ACTION_HEADER] = str(action.id)


def comparable(snapshots: list[dict]) -> dict[int, dict]:
    # Replaying stamps a fresh updated_at so the sync poll sees the restored rows.
    return {
        row["id"]: {key: value for key, value in row.items() if key != "updated_at"}
        for row in snapshots
    }


def replay(
    db: Session, campaign: Campaign, user_id: UUID, action_id: UUID, *, undo: bool
) -> tuple[list[int], list[int]]:
    from src.annotation import service
    from src.campaigns.policy import build_policy_context
    from src.tasks.models import Task
    from src.tasks.service import require_task_access

    action = db.scalar(
        select(AnnotationAction)
        .where(
            AnnotationAction.id == action_id,
            AnnotationAction.campaign_id == campaign.id,
            AnnotationAction.user_id == user_id,
            AnnotationAction.created_at >= func.now() - RETENTION,
        )
        .with_for_update()
    )
    if action is None:
        raise HTTPException(
            status_code=404, detail="This labelling action has expired or is missing"
        )
    if action.undone == undo:
        raise HTTPException(status_code=409, detail="This labelling action was already applied")
    expected, desired = (action.after, action.before) if undo else (action.before, action.after)
    ids = {row["id"] for row in [*expected, *desired]}
    current = list(
        db.scalars(
            select(Annotation)
            .where(Annotation.campaign_id == campaign.id, Annotation.id.in_(ids))
            .order_by(Annotation.id)
            .with_for_update()
        ).all()
    )
    if comparable([snapshot(row) for row in current]) != comparable(expected):
        raise HTTPException(
            status_code=409,
            detail="These annotations have changed since this action. Undo/redo was not applied.",
        )

    restored = [
        Annotation(
            **{
                key: UUID(value) if key == "created_by_user_id" else value
                for key, value in row.items()
            }
        )
        for row in desired
    ]
    service._require_own_annotations(db, current + restored, campaign, user_id, "change")
    task_ids = {
        row[key]
        for row in [*expected, *desired]
        for key in ("task_id", "origin_task_id", "output_of_task_id")
        if row[key] is not None
    }
    tasks = {
        task.id: task
        for task in db.scalars(
            select(Task).where(Task.campaign_id == campaign.id, Task.id.in_(task_ids))
        ).all()
    }
    if tasks.keys() != task_ids:
        raise HTTPException(status_code=409, detail="A task used by this action no longer exists")
    for row in restored:
        if row.task_id is not None:
            require_task_access(db, campaign, tasks[row.task_id], user_id)
        else:
            service._require_drawing_access(db, campaign, user_id, {row.output_of_task_id})
        if row.label_id is not None:
            service.validate_label_id(campaign, row.label_id)
        service.validate_annotation_form_values(
            campaign, row.form_values, enforce_required=row.label_id is not None
        )
    if (
        any(row.is_authoritative for row in restored)
        and not build_policy_context(db, campaign, user_id).is_authoritative
    ):
        raise HTTPException(status_code=403, detail="You may not restore authoritative answers")

    desired_ids = {row["id"] for row in desired}
    deleted_ids = sorted(ids - desired_ids)
    try:
        # Snapshots are server-owned, never supplied by the client. Populate the
        # table's actual types, including geometry, UUIDs, dates and JSON fields.
        db.execute(delete(Annotation).where(Annotation.id.in_(ids)))
        db.execute(delete(DeletedAnnotation).where(DeletedAnnotation.annotation_id.in_(ids)))
        for saved in desired:
            db.execute(
                text(
                    "INSERT INTO data.annotations OVERRIDING SYSTEM VALUE "
                    "SELECT restored.* FROM jsonb_populate_record("
                    "NULL::data.annotations, CAST(:snapshot AS jsonb) "
                    "|| jsonb_build_object('updated_at', clock_timestamp())) AS restored"
                ),
                {"snapshot": json.dumps(saved)},
            )
        record_annotation_deletions(db, campaign.id, deleted_ids)
        touch_tasks(db, task_ids)
        bump_campaign_annotations_version(db, campaign.id)
        action.undone = undo
        db.commit()
        db.expire_all()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=409, detail="Related data has changed. Undo/redo was not applied."
        ) from exc
    return sorted(desired_ids), deleted_ids
