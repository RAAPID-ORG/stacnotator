import os
from uuid import UUID, uuid4

import pytest
from fastapi import FastAPI, HTTPException, Response
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from src.annotation import history, service
from src.annotation.models import Annotation, AnnotationAction, DeletedAnnotation
from src.annotation.router import router
from src.annotation.schemas import AnnotationCreate, AnnotationUpdate, TaskAnswerCreate
from src.auth.dependencies import require_authenticated_user
from src.auth.models import User
from src.campaigns.dependencies import require_campaign_access
from src.campaigns.models import Campaign
from src.database import engine, get_db
from src.geometry import ewkt
from src.organizations.models import Organization
from src.projects.models import Project
from src.tasks.models import Task, TaskAssignment, TaskSet

pytestmark = pytest.mark.skipif(
    os.environ.get("ANNOTATION_HISTORY_DATABASE_TESTS") != "1",
    reason="Set ANNOTATION_HISTORY_DATABASE_TESTS=1 against a migrated PostgreSQL database",
)


@pytest.fixture
def history_db():
    with engine.connect() as connection, connection.begin() as transaction:
        with Session(bind=connection, join_transaction_mode="create_savepoint") as db:
            user = User(
                issuer="history-test",
                external_uid=str(uuid4()),
                email=f"{uuid4()}@example.test",
                is_platform_admin=True,
            )
            organization = Organization(name=f"History test {uuid4()}", status="approved")
            db.add_all([user, organization])
            db.flush()
            project = Project(name="History test", organization_id=organization.id)
            db.add(project)
            db.flush()
            campaign = Campaign(
                project_id=project.id,
                name="History test",
                bbox_west=-10,
                bbox_south=-10,
                bbox_east=10,
                bbox_north=10,
                labels=[
                    {"id": 1, "name": "Forest", "geometry_type": "point"},
                    {"id": 2, "name": "Water", "geometry_type": "point"},
                ],
            )
            db.add(campaign)
            db.flush()
            db.info["annotation_history_response"] = Response()
            yield db, campaign, user
        transaction.rollback()


def action_id(db):
    return UUID(db.info["annotation_history_response"].headers[history.ACTION_HEADER])


def create(db, campaign, user, **kwargs):
    return service.create_annotation(
        db, campaign, AnnotationCreate(label_id=1, geometry_wkt="POINT(1 2)", **kwargs), user.id
    )


def test_create_delete_and_repeated_replay_keep_identity_and_metadata(history_db):
    db, campaign, user = history_db
    annotation = create(
        db,
        campaign,
        user,
        comment="Keep me",
        confidence=7,
        flagged_for_review=True,
        flag_comment="Check this",
        slice_comments=[{"slice_id": 1, "text": "Cloudy"}],
    )
    saved = history.snapshot(annotation)
    created = action_id(db)
    history.replay(db, campaign, user.id, created, undo=True)
    assert db.get(Annotation, saved["id"]) is None
    assert db.get(DeletedAnnotation, saved["id"]) is not None
    history.replay(db, campaign, user.id, created, undo=False)
    assert history.comparable(
        [history.snapshot(db.get(Annotation, saved["id"]))]
    ) == history.comparable([saved])
    assert db.get(DeletedAnnotation, saved["id"]) is None
    service.delete_annotations(db, [saved["id"]], campaign, user.id)
    deleted = action_id(db)
    for _ in range(2):
        history.replay(db, campaign, user.id, deleted, undo=True)
        assert history.comparable(
            [history.snapshot(db.get(Annotation, saved["id"]))]
        ) == history.comparable([saved])
        history.replay(db, campaign, user.id, deleted, undo=False)
        assert db.get(Annotation, saved["id"]) is None


def test_updates_can_walk_back_and_forward_without_timestamp_conflicts(history_db):
    db, campaign, user = history_db
    annotation = create(db, campaign, user)
    annotation_id = annotation.id
    service.update_annotation(db, annotation_id, AnnotationUpdate(label_id=2), user.id, campaign)
    relabelled = action_id(db)
    service.update_annotation(
        db,
        annotation_id,
        AnnotationUpdate(geometry_wkt="POINT(3 4)", flagged_for_review=True),
        user.id,
        campaign,
    )
    reshaped = action_id(db)
    history.replay(db, campaign, user.id, reshaped, undo=True)
    history.replay(db, campaign, user.id, relabelled, undo=True)
    restored = db.get(Annotation, annotation_id)
    assert restored.label_id == 1
    assert not restored.flagged_for_review
    history.replay(db, campaign, user.id, relabelled, undo=False)
    history.replay(db, campaign, user.id, reshaped, undo=False)
    restored = db.get(Annotation, annotation_id)
    assert restored.label_id == 2
    assert restored.flagged_for_review
    assert history.to_shape(restored.geometry).wkt == "POINT (3 4)"


def test_changed_annotations_and_other_users_actions_are_not_overwritten(history_db):
    db, campaign, user = history_db
    annotation = create(db, campaign, user)
    created = action_id(db)
    with pytest.raises(HTTPException) as wrong_user:
        history.replay(db, campaign, uuid4(), created, undo=True)
    assert wrong_user.value.status_code == 404
    service.update_annotation(
        db, annotation.id, AnnotationUpdate(comment="Changed elsewhere"), user.id, campaign
    )
    with pytest.raises(HTTPException) as conflict:
        history.replay(db, campaign, user.id, created, undo=True)
    assert conflict.value.status_code == 409
    assert db.get(Annotation, annotation.id).comment == "Changed elsewhere"
    assert not db.get(AnnotationAction, created).undone


def test_batch_is_one_action_and_replay_preserves_original_author(history_db):
    db, campaign, user = history_db
    annotations = service.create_annotations(
        db,
        campaign,
        [AnnotationCreate(label_id=1, geometry_wkt=f"POINT({x} 2)") for x in range(3)],
        user.id,
    )
    ids = [row.id for row in annotations]
    created = action_id(db)
    history.replay(db, campaign, user.id, created, undo=True)
    assert not db.scalars(select(Annotation).where(Annotation.id.in_(ids))).all()
    history.replay(db, campaign, user.id, created, undo=False)
    other = User(issuer="history-test", external_uid=str(uuid4()), email=f"{uuid4()}@example.test")
    db.add(other)
    db.flush()
    db.get(Annotation, ids[0]).created_by_user_id = other.id
    db.commit()
    service.delete_annotations(db, ids, campaign, user.id)
    deleted = action_id(db)
    history.replay(db, campaign, user.id, deleted, undo=True)
    assert db.get(Annotation, ids[0]).created_by_user_id == other.id
    assert len(db.scalars(select(Annotation).where(Annotation.id.in_(ids))).all()) == 3


def test_task_submissions_do_not_record_undo_history(history_db):
    db, campaign, user = history_db
    task_set = TaskSet(campaign_id=campaign.id, name="Test")
    db.add(task_set)
    db.flush()
    task = Task(
        campaign_id=campaign.id,
        task_set_id=task_set.id,
        annotation_number=1,
        geometry=ewkt("POINT(1 2)"),
    )
    db.add(task)
    db.flush()
    db.add(TaskAssignment(task_id=task.id, user_id=user.id))
    db.commit()
    task_id = task.id
    service.submit_task_annotation(
        db, campaign, task_id, TaskAnswerCreate(label_id=1, active_ms=12000), user.id
    )
    service.submit_task_annotation(db, campaign, task_id, TaskAnswerCreate(), user.id)
    assert (
        db.scalar(select(AnnotationAction).where(AnnotationAction.campaign_id == campaign.id))
        is None
    )


def test_http_history_header_and_replay_response(history_db):
    db, campaign, user = history_db
    app = FastAPI()
    app.include_router(router, prefix="/api")
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[require_authenticated_user] = lambda: user
    app.dependency_overrides[require_campaign_access] = lambda: campaign
    client = TestClient(app, headers={"Authorization": "Bearer test"})
    created = client.post(
        f"/api/campaigns/{campaign.id}/annotations",
        headers={history.HISTORY_HEADER: "true"},
        json={"label_id": 1, "geometry_wkt": "POINT(1 2)"},
    )
    assert created.status_code == 200, created.text
    saved = created.json()
    action = created.headers[history.ACTION_HEADER]
    path = f"/api/campaigns/{campaign.id}/annotation-actions/{action}"
    undone = client.post(path, json={"undo": True})
    assert undone.status_code == 200, undone.text
    assert undone.json() == {"annotations": [], "deleted_ids": [saved["id"]]}
    redone = client.post(path, json={"undo": False})
    assert redone.status_code == 200, redone.text
    restored = redone.json()["annotations"][0]
    assert restored["id"] == saved["id"]
    assert restored["created_by_user_id"] == saved["created_by_user_id"]
