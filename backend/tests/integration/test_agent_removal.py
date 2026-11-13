import os
from uuid import uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy import delete, select, text
from sqlalchemy.orm import Session

from src.agents import service
from src.agents.models import AgentTaskDeferral, LabellingAgent
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
def agent_db(request):
    with engine.connect() as connection:
        transaction = connection.begin()
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
            committed = getattr(request, "param", False)
            if committed:
                transaction.commit()
            try:
                yield db, campaign, owner
            finally:
                if committed:
                    agent_ids = db.scalars(
                        select(LabellingAgent.user_id).where(
                            LabellingAgent.owner_user_id == owner.id
                        )
                    ).all()
                    db.execute(delete(Campaign).where(Campaign.id == campaign.id))
                    db.execute(delete(Project).where(Project.id == project.id))
                    db.execute(delete(Organization).where(Organization.id == organization.id))
                    db.execute(delete(User).where(User.id.in_([owner.id, *agent_ids])))
                    db.commit()
        if transaction.is_active:
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


@pytest.mark.parametrize("other_scope", ["different_set", "unscoped", "different_owner"])
def test_takeover_stays_in_the_same_owner_and_task_set(agent_db, other_scope):
    db, campaign, owner = agent_db
    task_set_id = db.scalar(select(TaskSet.id).where(TaskSet.campaign_id == campaign.id))
    donor = service.register_agent(
        db, campaign, owner, AgentRegister(name="donor", task_count=4, task_set_id=task_set_id)
    )
    scope = task_set_id
    receiver_owner = owner
    if other_scope == "different_set":
        other = TaskSet(campaign_id=campaign.id, name="Independent repeat")
        db.add(other)
        db.flush()
        scope = other.id
    elif other_scope == "unscoped":
        scope = None
    else:
        receiver_owner = make_user(db)
    receiver = service.register_agent(
        db,
        campaign,
        receiver_owner,
        AgentRegister(name="receiver", task_count=0, task_set_id=scope, takes_over_work=True),
    )
    assert service.next_tasks(db, receiver.user_id, receiver_owner).tasks == []
    assert len(assignments_of(db, donor.user_id)) == 4


def test_takeover_preserves_active_and_deferred_tasks(agent_db):
    db, campaign, owner = agent_db
    scope = db.scalar(select(TaskSet.id).where(TaskSet.campaign_id == campaign.id))
    donor = service.register_agent(
        db, campaign, owner, AgentRegister(name="donor", task_count=4, task_set_id=scope)
    )
    receiver = service.register_agent(
        db,
        campaign,
        owner,
        AgentRegister(name="receiver", task_count=0, task_set_id=scope, takes_over_work=True),
    )
    tasks = db.scalars(service._open_tasks_query(donor).order_by(Task.annotation_number)).all()
    service.defer_task(db, donor.user_id, owner, tasks[-1].id, "model content filter")
    moved = service.next_tasks(db, receiver.user_id, owner)
    assert [task.task_id for task in moved.tasks] == [tasks[-2].id]
    assert {a.task_id for a in assignments_of(db, donor.user_id)} == {
        tasks[0].id,
        tasks[1].id,
        tasks[-1].id,
    }


@pytest.mark.parametrize("agent_db", [True], indirect=True)
def test_takeover_skips_a_queue_locked_by_another_request(agent_db):
    db, campaign, owner = agent_db
    donor = register(db, campaign, owner, task_count=4)
    receiver = service.register_agent(
        db, campaign, owner, AgentRegister(name="receiver", task_count=0, takes_over_work=True)
    )
    donor_id, receiver_id, owner_id = donor.user_id, receiver.user_id, owner.id
    db.commit()
    with engine.begin() as locked:
        locked.execute(
            select(LabellingAgent.user_id)
            .where(LabellingAgent.user_id == donor_id)
            .with_for_update()
        )
        with Session(engine) as concurrent:
            concurrent.execute(text("SET LOCAL lock_timeout = '500ms'"))
            concurrent_owner = concurrent.get(User, owner_id)
            assert service.next_tasks(concurrent, receiver_id, concurrent_owner).tasks == []
    assert len(service.next_tasks(db, receiver_id, owner).tasks) == 1


def test_deferred_work_stays_unfinished_until_explicitly_resumed(agent_db):
    db, campaign, owner = agent_db
    agent = register(db, campaign, owner, task_count=2)
    first, second = service.next_tasks(db, agent.user_id, owner).tasks
    service.defer_task(db, agent.user_id, owner, first.task_id, "timeout")
    service.defer_task(db, agent.user_id, owner, first.task_id, "updated failure detail")
    ready = service.next_tasks(db, agent.user_id, owner)
    assert [task.task_id for task in ready.tasks] == [second.task_id]
    assert (ready.remaining, ready.deferred) == (2, 1)
    service.submit_annotation(
        db, agent.user_id, owner, second.task_id, TaskAnswerCreate(label_id=1)
    )
    pending = service.next_tasks(db, agent.user_id, owner)
    assert pending.tasks == []
    assert (pending.remaining, pending.deferred) == (1, 1)
    assert service.resume_deferred_tasks(db, agent.user_id, owner) == 1
    assert service.next_tasks(db, agent.user_id, owner).tasks[0].task_id == first.task_id
    service.defer_task(db, agent.user_id, owner, first.task_id, "timeout")
    service.release_tasks(db, owner, "admin", [agent])
    assert db.get(AgentTaskDeferral, (agent.user_id, first.task_id)) is None
    assert [a.task_id for a in assignments_of(db, agent.user_id)] == [second.task_id]


def test_deferral_rejects_another_owner_or_a_finished_task(agent_db):
    db, campaign, owner = agent_db
    agent = register(db, campaign, owner, task_count=1)
    task = service.next_tasks(db, agent.user_id, owner).tasks[0]
    with pytest.raises(HTTPException) as denied:
        service.defer_task(db, agent.user_id, make_user(db), task.task_id, "timeout")
    assert denied.value.status_code == 404
    service.submit_annotation(db, agent.user_id, owner, task.task_id, TaskAnswerCreate(label_id=1))
    with pytest.raises(HTTPException) as finished:
        service.defer_task(db, agent.user_id, owner, task.task_id, "timeout")
    assert finished.value.status_code == 409


def test_invalid_scope_is_rejected_before_creating_an_agent(agent_db):
    db, campaign, owner = agent_db
    with pytest.raises(HTTPException) as invalid:
        service.register_agent(
            db, campaign, owner, AgentRegister(name="invalid", task_count=0, task_set_id=-1)
        )
    assert invalid.value.status_code == 404
    assert service.owned_agents(db, campaign.id, owner) == []
