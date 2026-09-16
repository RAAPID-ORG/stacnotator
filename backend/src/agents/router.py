from uuid import UUID

from fastapi import APIRouter, Depends
from fastapi.security import HTTPBearer
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from src.agents import service
from src.agents.schemas import (
    AgentAnnotate,
    AgentOut,
    AgentRegister,
    AgentRegistrationOut,
    AgentTasksRequest,
    CampaignContext,
    RenderJobOut,
    RenderJobResult,
    TaskBundleOut,
    ViewsRequest,
)
from src.annotation.schemas import AnnotationTaskSubmitResponse
from src.auth.dependencies import require_authenticated_user
from src.auth.models import User
from src.campaigns.dependencies import require_campaign_access
from src.campaigns.models import Campaign
from src.database import get_db, release

bearer = HTTPBearer()  # Using only for adding bearer scheme to Swagger OpenAPI
router = APIRouter(
    tags=["Agents"],
    dependencies=[Depends(bearer), Depends(require_authenticated_user)],
)


@router.post(
    "/campaigns/{campaign_id}/agents",
    response_model=AgentRegistrationOut,
    response_model_exclude_none=True,
)
def register_agent(
    body: AgentRegister,
    db: Session = Depends(get_db),
    user: User = Depends(require_authenticated_user),
    campaign: Campaign = Depends(require_campaign_access),
) -> AgentRegistrationOut:
    agent, context, views = service.register_agent(db, campaign, user, body)
    return AgentRegistrationOut(
        agent=service.agent_out(db, agent),
        context=context,
        default_views=views,
    )


@router.get("/campaigns/{campaign_id}/agents", response_model=list[AgentOut])
def list_agents(
    db: Session = Depends(get_db),
    user: User = Depends(require_authenticated_user),
    campaign: Campaign = Depends(require_campaign_access),
) -> list[AgentOut]:
    return service.list_agents(db, campaign.id, user)


@router.get("/agents/{agent_id}", response_model=AgentOut)
def get_agent(
    agent_id: UUID,
    db: Session = Depends(get_db),
    user: User = Depends(require_authenticated_user),
) -> AgentOut:
    agent, _ = service.get_agent(db, agent_id, user)
    return service.agent_out(db, agent)


@router.get("/agents/{agent_id}/context", response_model=CampaignContext)
def get_agent_context(
    agent_id: UUID,
    db: Session = Depends(get_db),
    user: User = Depends(require_authenticated_user),
) -> CampaignContext:
    _, campaign = service.get_agent(db, agent_id, user)
    return service.campaign_context(db, campaign.id)


@router.post("/agents/{agent_id}/tasks", response_model=AgentOut)
def request_agent_tasks(
    agent_id: UUID,
    body: AgentTasksRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_authenticated_user),
) -> AgentOut:
    agent, _ = service.get_agent(db, agent_id, user)
    service.assign_tasks(db, agent, body.count, body.task_set_id)
    return service.agent_out(db, agent)


@router.post("/agents/{agent_id}/next", response_model=TaskBundleOut)
async def next_agent_task(
    agent_id: UUID,
    body: ViewsRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_authenticated_user),
) -> TaskBundleOut:
    """The agent's next open task with its views, waiting for the render host to draw them."""
    pending = await run_in_threadpool(service.prepare_next, db, agent_id, user, body.views)
    release(db)
    return await service.await_bundle(pending)


@router.post("/agents/{agent_id}/tasks/{task_id}/views", response_model=TaskBundleOut)
async def render_agent_views(
    agent_id: UUID,
    task_id: int,
    body: ViewsRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_authenticated_user),
) -> TaskBundleOut:
    pending = await run_in_threadpool(
        service.prepare_views, db, agent_id, user, task_id, body.views
    )
    release(db)
    return await service.await_bundle(pending)


@router.post(
    "/agents/{agent_id}/tasks/{task_id}/annotate", response_model=AnnotationTaskSubmitResponse
)
def annotate_agent_task(
    agent_id: UUID,
    task_id: int,
    body: AgentAnnotate,
    db: Session = Depends(get_db),
    user: User = Depends(require_authenticated_user),
) -> AnnotationTaskSubmitResponse:
    return service.submit_annotation(db, agent_id, user, task_id, body)


@router.post(
    "/campaigns/{campaign_id}/agents/render-jobs/claim", response_model=RenderJobOut | None
)
def claim_agent_render_job(
    db: Session = Depends(get_db),
    user: User = Depends(require_authenticated_user),
    campaign: Campaign = Depends(require_campaign_access),
) -> RenderJobOut | None:
    return service.claim_render_job(db, campaign, user)


@router.put("/agents/render-jobs/{job_id}", status_code=204)
def complete_agent_render_job(
    job_id: int,
    body: RenderJobResult,
    db: Session = Depends(get_db),
    user: User = Depends(require_authenticated_user),
) -> None:
    service.complete_render_job(db, job_id, user, body)
