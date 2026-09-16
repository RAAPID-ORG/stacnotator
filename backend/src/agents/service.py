import asyncio
import base64
import secrets
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

from fastapi import HTTPException
from sqlalchemy import delete, exists, func, or_, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session, joinedload
from starlette.concurrency import run_in_threadpool

from src.agents import views as agent_views
from src.agents.models import AgentRenderJob, LabellingAgent
from src.agents.schemas import (
    AgentAnnotate,
    AgentOut,
    AgentRegister,
    AgentTaskOut,
    CampaignContext,
    RenderedView,
    RenderJobOut,
    RenderJobResult,
    TaskBundleOut,
    ViewSpec,
)
from src.annotation import service as annotation_service
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
from src.campaigns.service import get_campaign_full
from src.database import SessionLocal
from src.projects.models import ProjectUser

AGENT_ISSUER = "agent"
# Tasks rendered ahead of the one being handed out.
PREFETCH_DEPTH = 2
# A host that has not polled for this long is treated as closed.
HOST_TIMEOUT = timedelta(seconds=20)
# A claimed job not reported back in this time goes to the next host that asks.
RENDER_LEASE = timedelta(seconds=90)
WAIT_TIMEOUT_SECONDS = 120.0
POLL_SECONDS = 0.3
FINISHED_JOB_RETENTION = timedelta(hours=2)


def get_agent(db: Session, agent_id: UUID, owner: User) -> tuple[LabellingAgent, Campaign]:
    """The owner's agent and its campaign, checking the owner can still reach it."""
    agent = db.get(LabellingAgent, agent_id)
    if agent is None or agent.owner_user_id != owner.id:
        raise HTTPException(status_code=404, detail="Agent not found")
    campaign = require_campaign_access(agent.campaign_id, db, owner)
    return agent, campaign


def campaign_context(db: Session, campaign_id: int) -> CampaignContext:
    return agent_views.build_context(get_campaign_full(db, campaign_id))


def register_agent(
    db: Session, campaign: Campaign, owner: User, req: AgentRegister
) -> tuple[LabellingAgent, CampaignContext, list[ViewSpec]]:
    context = campaign_context(db, campaign.id)
    if context.sample_extent_meters is None and _has_point_tasks(db, campaign.id):
        raise HTTPException(
            status_code=409,
            detail="Set the campaign's sample extent before registering agents: it is the "
            "box drawn around each point so an agent knows what it is labelling.",
        )
    views = req.default_views or agent_views.default_views(context)
    for view in views:
        agent_views.check_view(context, view)

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
        default_views=[v.model_dump(mode="json", exclude_none=True) for v in views],
    )
    db.add(agent)
    db.commit()

    if req.task_count:
        assign_tasks(db, agent, req.task_count, req.task_set_id)
    return agent, context, views


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


def list_agents(db: Session, campaign_id: int, owner: User) -> list[AgentOut]:
    agents = db.scalars(
        select(LabellingAgent)
        .options(joinedload(LabellingAgent.user))
        .where(LabellingAgent.campaign_id == campaign_id, LabellingAgent.owner_user_id == owner.id)
        .order_by(LabellingAgent.created_at)
    ).all()
    return [agent_out(db, agent) for agent in agents]


def agent_out(db: Session, agent: LabellingAgent) -> AgentOut:
    assigned = db.scalar(
        select(func.count())
        .select_from(AnnotationTaskAssignment)
        .where(
            AnnotationTaskAssignment.user_id == agent.user_id, ~AnnotationTaskAssignment.is_review
        )
    )
    project_id = db.scalar(select(Campaign.project_id).where(Campaign.id == agent.campaign_id))
    return AgentOut(
        agent_id=agent.user_id,
        name=agent.user.display_name or "",
        description=agent.description,
        campaign_id=agent.campaign_id,
        render_host_path=f"/projects/{project_id}/campaigns/{agent.campaign_id}/agents",
        assigned=assigned or 0,
        remaining=_open_task_count(db, agent),
        host_seen_at=agent.host_seen_at,
        created_at=agent.created_at,
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
    lat, lon, wkt = agent_views.task_point(task)
    return AgentTaskOut(
        task_id=task.id,
        annotation_number=task.annotation_number,
        lat=lat,
        lon=lon,
        geometry_wkt=wkt,
    )


@dataclass(frozen=True)
class PendingBundle:
    """A task and the render jobs its bundle waits on, detached from any session."""

    task: AgentTaskOut | None
    remaining: int
    jobs: list[tuple[int, ViewSpec]]
    host_alive: bool


def _views_or_default(agent: LabellingAgent, views: list[ViewSpec] | None) -> list[ViewSpec]:
    return views or [ViewSpec.model_validate(v) for v in agent.default_views]


def _check_views(db: Session, campaign: Campaign, views: list[ViewSpec] | None) -> None:
    if not views:
        return
    context = campaign_context(db, campaign.id)
    for view in views:
        agent_views.check_view(context, view)


def _host_alive(db: Session, agent: LabellingAgent) -> bool:
    """A host polls for all of its owner's agents in a campaign, so one registered a
    moment ago is covered by the host its siblings have already seen."""
    seen = db.scalar(
        select(func.max(LabellingAgent.host_seen_at)).where(
            LabellingAgent.campaign_id == agent.campaign_id,
            LabellingAgent.owner_user_id == agent.owner_user_id,
        )
    )
    return seen is not None and seen > datetime.now(UTC) - HOST_TIMEOUT


def prepare_next(
    db: Session, agent_id: UUID, owner: User, views: list[ViewSpec] | None
) -> PendingBundle:
    """Pick the agent's next open task, queue its views, and queue the same views for the
    tasks after it so they are already drawn when the agent gets there."""
    agent, campaign = get_agent(db, agent_id, owner)
    _check_views(db, campaign, views)
    requested = _views_or_default(agent, views)

    upcoming = db.scalars(
        _open_tasks_query(agent)
        .options(joinedload(AnnotationTask.geometry))
        .order_by(AnnotationTask.annotation_number)
        .limit(PREFETCH_DEPTH + 1)
    ).all()
    if not upcoming:
        return PendingBundle(None, 0, [], _host_alive(db, agent))

    jobs = _enqueue(db, agent, upcoming[0].id, requested, priority=0)
    for task in upcoming[1:]:
        _enqueue(db, agent, task.id, requested, priority=1)
    _prune_finished(db, agent)
    db.commit()
    return PendingBundle(
        _task_out(upcoming[0]),
        _open_task_count(db, agent),
        jobs,
        _host_alive(db, agent),
    )


def prepare_views(
    db: Session, agent_id: UUID, owner: User, task_id: int, views: list[ViewSpec] | None
) -> PendingBundle:
    agent, campaign = get_agent(db, agent_id, owner)
    task = db.scalars(
        _open_tasks_query(agent)
        .options(joinedload(AnnotationTask.geometry))
        .where(AnnotationTask.id == task_id)
    ).first()
    if task is None:
        raise HTTPException(status_code=404, detail="Task is not an open task of this agent")
    _check_views(db, campaign, views)
    jobs = _enqueue(db, agent, task.id, _views_or_default(agent, views), priority=0)
    db.commit()
    return PendingBundle(_task_out(task), _open_task_count(db, agent), jobs, _host_alive(db, agent))


def _enqueue(
    db: Session, agent: LabellingAgent, task_id: int, views: list[ViewSpec], priority: int
) -> list[tuple[int, ViewSpec]]:
    """Get-or-create one job per view. A failed job is retried, and a job an agent now
    waits on jumps ahead of the ones rendered speculatively."""
    keyed = {agent_views.view_key(view): view for view in views}
    db.execute(
        insert(AgentRenderJob)
        .values(
            [
                {
                    "agent_user_id": agent.user_id,
                    "task_id": task_id,
                    "view_key": key,
                    "view": view.model_dump(mode="json", exclude_none=True),
                    "priority": priority,
                }
                for key, view in keyed.items()
            ]
        )
        .on_conflict_do_nothing()
    )
    in_views = (
        AgentRenderJob.agent_user_id == agent.user_id,
        AgentRenderJob.task_id == task_id,
        AgentRenderJob.view_key.in_(keyed),
    )
    db.execute(
        update(AgentRenderJob)
        .where(*in_views, AgentRenderJob.status == "failed")
        .values(status="pending", error=None, claimed_at=None)
    )
    if priority == 0:
        db.execute(update(AgentRenderJob).where(*in_views).values(priority=0))
    rows = db.execute(select(AgentRenderJob.view_key, AgentRenderJob.id).where(*in_views))
    ids = {key: job_id for key, job_id in rows}
    return [(ids[agent_views.view_key(view)], view) for view in views]


def _prune_finished(db: Session, agent: LabellingAgent) -> None:
    db.execute(
        delete(AgentRenderJob).where(
            AgentRenderJob.agent_user_id == agent.user_id,
            AgentRenderJob.created_at < datetime.now(UTC) - FINISHED_JOB_RETENTION,
        )
    )


async def await_bundle(pending: PendingBundle) -> TaskBundleOut:
    """Wait, without holding a connection, until every view is drawn or failed."""
    job_ids = [job_id for job_id, _ in pending.jobs]
    loop = asyncio.get_running_loop()
    deadline = loop.time() + WAIT_TIMEOUT_SECONDS
    while job_ids and pending.host_alive and loop.time() < deadline:
        statuses = await run_in_threadpool(_job_statuses, job_ids)
        if all(status in ("done", "failed") for status in statuses):
            break
        await asyncio.sleep(POLL_SECONDS)

    rows = await run_in_threadpool(_read_jobs, job_ids)
    views = []
    for job_id, view in pending.jobs:
        row = rows.get(job_id)
        if row is not None and row.status == "done" and row.image is not None:
            views.append(
                RenderedView(
                    view=view,
                    status="done",
                    mime_type=row.mime_type,
                    image_base64=base64.b64encode(row.image).decode(),
                    meta=row.meta,
                )
            )
        else:
            views.append(
                RenderedView(
                    view=view, status=row.status if row else "missing", error=_why(row, pending)
                )
            )
    return TaskBundleOut(task=pending.task, remaining=pending.remaining, views=views)


def _why(row: AgentRenderJob | None, pending: PendingBundle) -> str:
    if row is not None and row.error:
        return row.error
    if not pending.host_alive:
        return "No render host is open. Open the campaign's Agents page in a browser."
    return "Timed out waiting for the render host"


def _job_statuses(job_ids: list[int]) -> list[str]:
    with SessionLocal() as db:
        return list(db.scalars(select(AgentRenderJob.status).where(AgentRenderJob.id.in_(job_ids))))


def _read_jobs(job_ids: list[int]) -> dict[int, AgentRenderJob]:
    with SessionLocal() as db:
        rows = db.scalars(select(AgentRenderJob).where(AgentRenderJob.id.in_(job_ids))).all()
        return {row.id: row for row in rows}


def claim_render_job(db: Session, campaign: Campaign, owner: User) -> RenderJobOut | None:
    """Hand the owner's render host the most urgent job of their agents in this campaign."""
    now = datetime.now(UTC)
    db.execute(
        update(LabellingAgent)
        .where(LabellingAgent.campaign_id == campaign.id, LabellingAgent.owner_user_id == owner.id)
        .values(host_seen_at=func.now())
    )
    job = db.scalars(
        select(AgentRenderJob)
        .join(LabellingAgent, LabellingAgent.user_id == AgentRenderJob.agent_user_id)
        .where(
            LabellingAgent.campaign_id == campaign.id,
            LabellingAgent.owner_user_id == owner.id,
            or_(
                AgentRenderJob.status == "pending",
                (AgentRenderJob.status == "rendering")
                & (AgentRenderJob.claimed_at < now - RENDER_LEASE),
            ),
        )
        .order_by(AgentRenderJob.priority, AgentRenderJob.created_at)
        .limit(1)
        .with_for_update(of=AgentRenderJob, skip_locked=True)
    ).first()
    if job is None:
        db.commit()
        return None

    job.status = "rendering"
    job.claimed_at = now
    task = db.scalars(
        select(AnnotationTask)
        .options(joinedload(AnnotationTask.geometry))
        .where(AnnotationTask.id == job.task_id)
    ).one()
    out = RenderJobOut(
        job_id=job.id,
        agent_id=job.agent_user_id,
        task=_task_out(task),
        view=ViewSpec.model_validate(job.view),
    )
    db.commit()
    return out


def complete_render_job(db: Session, job_id: int, owner: User, result: RenderJobResult) -> None:
    job = db.scalars(
        select(AgentRenderJob)
        .join(LabellingAgent, LabellingAgent.user_id == AgentRenderJob.agent_user_id)
        .where(AgentRenderJob.id == job_id, LabellingAgent.owner_user_id == owner.id)
    ).first()
    if job is None:
        raise HTTPException(status_code=404, detail="Render job not found")
    if result.error is not None:
        job.status = "failed"
        job.error = result.error
    else:
        job.status = "done"
        job.image = base64.b64decode(result.image_base64 or "", validate=True)
        job.mime_type = result.mime_type
    job.meta = result.meta
    db.commit()


def submit_annotation(
    db: Session, agent_id: UUID, owner: User, task_id: int, body: AgentAnnotate
) -> AnnotationTaskSubmitResponse:
    agent, campaign = get_agent(db, agent_id, owner)
    response = annotation_service.submit_task_annotation(
        db=db, campaign=campaign, task_id=task_id, annotation_create=body, user_id=agent.user_id
    )
    db.execute(
        delete(AgentRenderJob).where(
            AgentRenderJob.agent_user_id == agent.user_id, AgentRenderJob.task_id == task_id
        )
    )
    db.commit()
    return response
