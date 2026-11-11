import os
from uuid import uuid4

import pytest
from sqlalchemy.orm import Session

from src.annotation import service as annotation_service
from src.annotation.schemas import TaskAnswerCreate
from src.auth.models import User
from src.campaigns.models import Campaign
from src.database import engine
from src.geometry import ewkt
from src.organizations.models import Organization
from src.projects.models import Project
from src.tasks import service
from src.tasks.models import Task, TaskAssignment, TaskSet
from src.tasks.schemas import TaskOut

pytestmark = pytest.mark.skipif(
    os.environ.get("AGENT_DATABASE_TESTS") != "1",
    reason="Set AGENT_DATABASE_TESTS=1 against a migrated PostgreSQL database",
)

# Two annotators on every task; what each answers, None meaning a skip.
ANSWERS: dict[str, tuple] = {
    "pending": (),
    "partial": (1,),
    "done": (1, 1),
    "conflicting": (1, 2),
    "skipped": (None, None),
}


def make_user(db: Session) -> User:
    user = User(
        issuer="density-test",
        external_uid=str(uuid4()),
        email=f"{uuid4()}@example.test",
        is_platform_admin=True,
    )
    db.add(user)
    db.flush()
    return user


@pytest.fixture
def answered_campaign():
    with engine.connect() as connection, connection.begin() as transaction:
        with Session(bind=connection, join_transaction_mode="create_savepoint") as db:
            organization = Organization(name=f"Density test {uuid4()}", status="approved")
            db.add(organization)
            db.flush()
            project = Project(name="Density test", organization_id=organization.id)
            db.add(project)
            db.flush()
            campaign = Campaign(
                project_id=project.id,
                name="Density test",
                bbox_west=-10,
                bbox_south=-10,
                bbox_east=10,
                bbox_north=10,
                labels=[
                    {"id": 1, "name": "Forest", "geometry_type": "point"},
                    {"id": 2, "name": "Crop", "geometry_type": "point"},
                ],
            )
            db.add(campaign)
            db.flush()
            task_set = TaskSet(campaign_id=campaign.id, name="Test")
            db.add(task_set)
            db.flush()
            annotators = [make_user(db), make_user(db)]
            tasks = {}
            for n, case in enumerate(ANSWERS, start=1):
                task = Task(
                    campaign_id=campaign.id,
                    task_set_id=task_set.id,
                    annotation_number=n,
                    geometry=ewkt(f"POINT({n} 2)"),
                )
                db.add(task)
                db.flush()
                db.add_all(TaskAssignment(task_id=task.id, user_id=u.id) for u in annotators)
                tasks[case] = task.id
            db.commit()
            for case, answers in ANSWERS.items():
                for user, label_id in zip(annotators, answers, strict=False):
                    annotation_service.submit_task_annotation(
                        db, campaign, tasks[case], TaskAnswerCreate(label_id=label_id), user.id
                    )
            yield db, campaign, tasks
        transaction.rollback()


def test_the_map_shows_the_status_the_task_list_does(answered_campaign):
    db, campaign, tasks = answered_campaign

    listed = {
        task.id: TaskOut.model_validate(task).task_status
        for task in service.get_tasks(db, campaign)
    }
    mapped = service._status_by_task(db, campaign, tasks.values())

    assert listed == {tasks[case]: case for case in ANSWERS}
    assert {task_id: status for task_id, (status, _) in mapped.items()} == listed
    assert mapped[tasks["done"]][1] == 1
    assert mapped[tasks["conflicting"]][1] is None


def test_density_counts_only_the_tasks_in_view(answered_campaign):
    db, campaign, tasks = answered_campaign

    cells = service.get_task_density(db, campaign, target_cells=400, bbox=(0.5, 1, 2.5, 3))

    assert sorted(c["task_status"] for c in cells) == ["partial", "pending"]
    assert sum(c["count"] for c in cells) == 2
