import os
from uuid import uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from src.agents import service
from src.agents.models import LabellingAgent
from src.agents.schemas import AgentRegister
from src.annotation.schemas import TaskAnswerCreate
from src.auth.models import User
from src.campaigns.models import Campaign
from src.database import engine
from src.geometry import ewkt
from src.organizations.models import Organization
from src.projects.models import Project
from src.tasks.models import Task, TaskAssignment, TaskSet

pytestmark = pytest.mark.skipif(
    os.environ.get("AGENT_DATABASE_TESTS") != "1",
    reason="Set AGENT_DATABASE_TESTS=1 against a migrated PostgreSQL database",
)


def make_user(db: Session) -> User:
    user = User(
        issuer="agent-test",
        external_uid=str(uuid4()),
        email=f"{uuid4()}@example.test",
        is_platform_admin=True,
    )
    db.add(user)
    db.flush()
    return user


@pytest.fixture
def agent_db():
    with engine.connect() as connection, connection.begin() as transaction:
        with Session(bind=connection, join_transaction_mode="create_savepoint") as db:
            owner = make_user(db)
            organization = Organization(name=f"Agent test {uuid4()}", status="approved")
            db.add(organization)
            db.flush()
            project = Project(name="Agent test", organization_id=organization.id)
            db.add(project)
            db.flush()
            campaign = Campaign(
                project_id=project.id,
                name="Agent test",
                bbox_west=-10,
                bbox_south=-10,
                bbox_east=10,
                bbox_north=10,
                sample_extent_meters=100,
                labels=[{"id": 1, "name": "Forest", "geometry_type": "point"}],
            )
            db.add(campaign)
            db.flush()
            task_set = TaskSet(campaign_id=campaign.id, name="Test")
            db.add(task_set)
            db.flush()
            db.add_all(
                Task(
                    campaign_id=campaign.id,
                    task_set_id=task_set.id,
                    annotation_number=n,
                    geometry=ewkt(f"POINT({n} 2)"),
                )
                for n in range(1, 5)
            )
            db.commit()
            yield db, campaign, owner
        transaction.rollback()


def register(db, campaign, owner, task_count):
    return service.register_agent(
        db, campaign, owner, AgentRegister(name="test", task_count=task_count)
    )


def assignments_of(db, user_id):
    return db.scalars(select(TaskAssignment).where(TaskAssignment.user_id == user_id)).all()


def test_removing_an_agent_that_labelled_frees_its_tasks_and_keeps_its_work(agent_db):
    db, campaign, owner = agent_db
    agent = register(db, campaign, owner, task_count=3)
    agent_id = agent.user_id
    labelled = assignments_of(db, agent_id)[0].task_id
    service.submit_annotation(db, agent_id, owner, labelled, TaskAnswerCreate(label_id=1))

    service.remove_agent(db, agent_id, owner)

    assert db.get(LabellingAgent, agent_id) is None
    assert service.owned_agents(db, campaign.id, owner) == []
    assert db.get(User, agent_id) is not None
    assert [a.task_id for a in assignments_of(db, agent_id)] == [labelled]


def test_removing_an_unused_agent_deletes_its_user(agent_db):
    db, campaign, owner = agent_db
    agent_id = register(db, campaign, owner, task_count=2).user_id

    service.remove_agent(db, agent_id, owner)

    assert db.get(User, agent_id) is None
    assert assignments_of(db, agent_id) == []


def test_removed_agents_make_room_under_the_limit(agent_db, monkeypatch):
    db, campaign, owner = agent_db
    monkeypatch.setattr(service, "MAX_AGENTS_PER_OWNER", 1)
    agent_id = register(db, campaign, owner, task_count=0).user_id
    with pytest.raises(HTTPException) as full:
        register(db, campaign, owner, task_count=0)
    assert full.value.status_code == 409

    service.remove_agent(db, agent_id, owner)

    register(db, campaign, owner, task_count=0)


def test_only_the_owner_can_remove_an_agent(agent_db):
    db, campaign, owner = agent_db
    agent_id = register(db, campaign, owner, task_count=0).user_id

    with pytest.raises(HTTPException) as denied:
        service.remove_agent(db, agent_id, make_user(db))

    assert denied.value.status_code == 404
    assert db.get(LabellingAgent, agent_id) is not None
