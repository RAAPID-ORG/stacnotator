import secrets
from typing import Any, cast
from uuid import UUID, uuid4

from fastapi import HTTPException
from geoalchemy2.shape import to_shape
from sqlalchemy import CursorResult, delete, exists, func, select
from sqlalchemy.orm import Session, joinedload

from src.agents.models import LabellingAgent
from src.agents.schemas import (
    AgentAnnotate,
    AgentOut,
    AgentRegister,
    AgentsOverviewOut,
    AgentTaskOut,
    NextTasksOut,
)
from src.annotation import service as annotation_service
from src.annotation.claims import is_free_work
from src.annotation.models import (
    Annotation,
    AnnotationGeometry,
    AnnotationTask,
    AnnotationTaskAssignment,
)
from src.annotation.schemas import AnnotationTaskSubmitResponse
from src.auth.models import User
from src.campaigns.assignments import assign_tasks_to_users
from src.campaigns.dependencies import require_campaign_access
from src.campaigns.models import Campaign
from src.campaigns.schemas import AssignTasksToUsersRequest
from src.projects.models import ProjectUser

AGENT_ISSUER = "agent"
# The task to label now plus the ones after it the caller draws ahead.
UPCOMING_TASKS = 3


def get_agent(db: Session, agent_id: UUID, owner: User) -> tuple[LabellingAgent, Campaign]:
    """The owner's agent and its campaign, checking the owner can still reach it."""
    agent = db.get(LabellingAgent, agent_id)
    if agent is None or agent.owner_user_id != owner.id:
        raise HTTPException(status_code=404, detail="Agent not found")
    campaign = require_campaign_access(agent.campaign_id, db, owner)
    return agent, campaign


def register_agent(
    db: Session, campaign: Campaign, owner: User, req: AgentRegister
) -> LabellingAgent:
    if campaign.settings.sample_extent_meters is None and _has_point_tasks(db, campaign.id):
        raise HTTPException(
            status_code=409,
            detail="Set the campaign's sample extent before registering agents: it is the "
            "box drawn around each point so an agent knows what it is labelling.",
        )

    agent_uid = uuid4()
    db.add(
        User(
            id=agent_uid,
            issuer=AGENT_ISSUER,
            external_uid=str(agent_uid),
            email=f"{agent_uid}@agents.stacnotator.invalid",
            display_name=f"{req.name}-{secrets.token_hex(3)}",
        )
    )
    db.flush()
    db.add(ProjectUser(project_id=campaign.project_id, user_id=agent_uid, is_admin=False))
    agent = LabellingAgent(
        user_id=agent_uid,
        owner_user_id=owner.id,
        campaign_id=campaign.id,
        description=req.description,
        takes_over_work=req.takes_over_work,
    )
    db.add(agent)
    db.commit()

    if req.task_count:
        assign_tasks(db, agent, req.task_count, req.task_set_id)
    return agent


def _has_point_tasks(db: Session, campaign_id: int) -> bool:
    return (
        db.scalar(
            select(AnnotationTask.id)
            .join(AnnotationGeometry, AnnotationGeometry.id == AnnotationTask.geometry_id)
            .where(
                AnnotationTask.campaign_id == campaign_id,
                func.ST_GeometryType(AnnotationGeometry.geometry) == "ST_Point",
            )
            .limit(1)
        )
        is not None
    )


def assign_tasks(db: Session, agent: LabellingAgent, count: int, task_set_id: int | None) -> int:
    return assign_tasks_to_users(
        db,
        agent.campaign_id,
        AssignTasksToUsersRequest(
            strategy="fixed_per_user",
            user_task_counts={agent.user_id: count},
            task_set_id=task_set_id,
        ),
    ).total_assigned


def owned_agents(db: Session, campaign_id: int, owner: User) -> list[LabellingAgent]:
    return list(
        db.scalars(
            select(LabellingAgent)
            .options(joinedload(LabellingAgent.user))
            .where(
                LabellingAgent.campaign_id == campaign_id,
                LabellingAgent.owner_user_id == owner.id,
            )
            .order_by(LabellingAgent.created_at)
        ).all()
    )


def agent_out(db: Session, agent: LabellingAgent) -> AgentOut:
    assigned = db.scalar(
        select(func.count())
        .select_from(AnnotationTaskAssignment)
        .where(
            AnnotationTaskAssignment.user_id == agent.user_id, ~AnnotationTaskAssignment.is_review
        )
    )
    return AgentOut(
        agent_id=agent.user_id,
        name=agent.user.display_name or "",
        description=agent.description,
        campaign_id=agent.campaign_id,
        assigned=assigned or 0,
        remaining=_open_task_count(db, agent),
        takes_over_work=agent.takes_over_work,
        created_at=agent.created_at,
    )


def agents_overview(db: Session, campaign: Campaign, owner: User) -> AgentsOverviewOut:
    total = db.scalar(
        select(func.count())
        .select_from(AnnotationTask)
        .where(AnnotationTask.campaign_id == campaign.id)
    )
    open_tasks = db.scalar(
        select(func.count())
        .select_from(AnnotationTask)
        .where(AnnotationTask.campaign_id == campaign.id, is_free_work())
    )
    return AgentsOverviewOut(
        campaign_id=campaign.id,
        name=campaign.name,
        total_tasks=total or 0,
        open_tasks=open_tasks or 0,
        agents=[agent_out(db, agent) for agent in owned_agents(db, campaign.id, owner)],
    )


def _open_tasks_query(agent: LabellingAgent):
    """The agent's assigned tasks it has not labelled or skipped yet."""
    return (
        select(AnnotationTask)
        .join(AnnotationTaskAssignment, AnnotationTaskAssignment.task_id == AnnotationTask.id)
        .where(
            AnnotationTaskAssignment.user_id == agent.user_id,
            ~AnnotationTaskAssignment.is_review,
            ~exists().where(
                Annotation.annotation_task_id == AnnotationTask.id,
                Annotation.created_by_user_id == agent.user_id,
            ),
        )
    )


def _open_task_count(db: Session, agent: LabellingAgent) -> int:
    return db.scalar(select(func.count()).select_from(_open_tasks_query(agent).subquery())) or 0


def _task_out(task: AnnotationTask) -> AgentTaskOut:
    """Polygons are placed at their centroid."""
    shape = to_shape(task.geometry.geometry)
    centroid = shape.centroid
    return AgentTaskOut(
        task_id=task.id,
        annotation_number=task.annotation_number,
        lat=centroid.y,
        lon=centroid.x,
        geometry_wkt=shape.wkt,
    )


def next_tasks(db: Session, agent_id: UUID, owner: User) -> NextTasksOut:
    agent, _ = get_agent(db, agent_id, owner)
    upcoming = _upcoming_tasks(db, agent)
    if not upcoming and agent.takes_over_work and _take_over_task(db, agent):
        upcoming = _upcoming_tasks(db, agent)
    return NextTasksOut(
        campaign_id=agent.campaign_id,
        remaining=_open_task_count(db, agent),
        tasks=[_task_out(task) for task in upcoming],
    )


def _upcoming_tasks(db: Session, agent: LabellingAgent) -> list[AnnotationTask]:
    return list(
        db.scalars(
            _open_tasks_query(agent)
            .options(joinedload(AnnotationTask.geometry))
            .order_by(AnnotationTask.annotation_number)
            .limit(UPCOMING_TASKS)
        ).all()
    )


def _take_over_task(db: Session, agent: LabellingAgent) -> bool:
    """Move one task from the sibling agent with the most work left to this one.

    A sibling keeps its next task, which it may be looking at right now, and gives up
    its last one, which it would reach last. Siblings are the same owner's agents in the
    same campaign, so an owner's agents only ever share their own work.
    """
    siblings = db.scalars(
        select(LabellingAgent).where(
            LabellingAgent.campaign_id == agent.campaign_id,
            LabellingAgent.owner_user_id == agent.owner_user_id,
            LabellingAgent.user_id != agent.user_id,
        )
    ).all()
    for sibling in sorted(siblings, key=lambda s: _open_task_count(db, s), reverse=True):
        open_ids = db.scalars(
            _open_tasks_query(sibling)
            .with_only_columns(AnnotationTask.id)
            .order_by(AnnotationTask.annotation_number)
        ).all()
        for task_id in reversed(open_ids[1:]):
            assignment = db.scalars(
                select(AnnotationTaskAssignment)
                .where(
                    AnnotationTaskAssignment.task_id == task_id,
                    AnnotationTaskAssignment.user_id == sibling.user_id,
                )
                .with_for_update(skip_locked=True)
            ).first()
            if assignment is None:
                continue
            assignment.user_id = agent.user_id
            db.commit()
            return True
    return False


def release_tasks(db: Session, agents: list[LabellingAgent]) -> int:
    """Hand the agents' unfinished tasks back to the pool. What they labelled or skipped
    stays theirs, and so do its assignments, so their finished work keeps counting."""
    agent_ids = [agent.user_id for agent in agents]
    if not agent_ids:
        return 0
    released = db.execute(
        delete(AnnotationTaskAssignment).where(
            AnnotationTaskAssignment.user_id.in_(agent_ids),
            ~AnnotationTaskAssignment.is_review,
            ~exists().where(
                Annotation.annotation_task_id == AnnotationTaskAssignment.task_id,
                Annotation.created_by_user_id == AnnotationTaskAssignment.user_id,
            ),
        )
    )
    db.commit()
    return cast("CursorResult[Any]", released).rowcount


def submit_annotation(
    db: Session, agent_id: UUID, owner: User, task_id: int, body: AgentAnnotate
) -> AnnotationTaskSubmitResponse:
    agent, campaign = get_agent(db, agent_id, owner)
    return annotation_service.submit_task_annotation(
        db=db, campaign=campaign, task_id=task_id, annotation_create=body, user_id=agent.user_id
    )
