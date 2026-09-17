from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import HTTPBearer
from sqlalchemy.orm import Session

from src.agents import service
from src.agents.schemas import (
    AgentAnnotate,
    AgentOut,
    AgentRegister,
    AgentsOverviewOut,
    AgentUpdate,
    NextTasksOut,
    ReleasedTasksOut,
)
from src.annotation.schemas import AnnotationTaskSubmitResponse
from src.auth.dependencies import require_authenticated_user
from src.auth.models import User
from src.campaigns.dependencies import require_campaign_access
from src.campaigns.models import Campaign
from src.database import get_db

bearer = HTTPBearer()  # Using only for adding bearer scheme to Swagger OpenAPI
router = APIRouter(
    tags=["Agents"],
    dependencies=[Depends(bearer), Depends(require_authenticated_user)],
)


@router.post("/campaigns/{campaign_id}/agents", response_model=AgentOut)
def register_agent(
    body: AgentRegister,
    db: Session = Depends(get_db),
    user: User = Depends(require_authenticated_user),
    campaign: Campaign = Depends(require_campaign_access),
) -> AgentOut:
    agent = service.register_agent(db, campaign, user, body)
    return service.agent_out(db, agent)


@router.get("/campaigns/{campaign_id}/agents", response_model=AgentsOverviewOut)
def list_agents(
    db: Session = Depends(get_db),
    user: User = Depends(require_authenticated_user),
    campaign: Campaign = Depends(require_campaign_access),
) -> AgentsOverviewOut:
    """Open and total tasks and the caller's agents, for sizing a labelling run."""
    return service.agents_overview(db, campaign, user)


@router.post("/campaigns/{campaign_id}/agents/release-tasks", response_model=ReleasedTasksOut)
def release_agent_tasks(
    agent_id: UUID | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(require_authenticated_user),
    campaign: Campaign = Depends(require_campaign_access),
) -> ReleasedTasksOut:
    """Take unfinished tasks off one of the caller's agents, or off all of them."""
    role = service.owner_role(db, campaign, user)
    agents = service.owned_agents(db, campaign.id, user)
    if agent_id is not None:
        agents = [agent for agent in agents if agent.user_id == agent_id]
        if not agents:
            raise HTTPException(status_code=404, detail="Agent not found")
    return ReleasedTasksOut(released=service.release_tasks(db, user, role, agents))


@router.get("/agents/{agent_id}", response_model=AgentOut)
def get_agent(
    agent_id: UUID,
    db: Session = Depends(get_db),
    user: User = Depends(require_authenticated_user),
) -> AgentOut:
    agent, _, _ = service.get_agent(db, agent_id, user)
    return service.agent_out(db, agent)


@router.patch("/agents/{agent_id}", response_model=AgentOut)
def update_agent(
    agent_id: UUID,
    body: AgentUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_authenticated_user),
) -> AgentOut:
    agent, _, _ = service.get_agent(db, agent_id, user)
    agent.takes_over_work = body.takes_over_work
    db.commit()
    return service.agent_out(db, agent)


@router.post("/agents/{agent_id}/next", response_model=NextTasksOut)
def next_agent_tasks(
    agent_id: UUID,
    db: Session = Depends(get_db),
    user: User = Depends(require_authenticated_user),
) -> NextTasksOut:
    return service.next_tasks(db, agent_id, user)


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
