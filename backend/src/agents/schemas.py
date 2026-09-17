from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

from src.annotation.schemas import AnnotationFromTaskCreate


class AgentRegister(BaseModel):
    name: str = Field(min_length=1, max_length=20, pattern=r"^[a-zA-Z0-9][a-zA-Z0-9._-]*$")
    description: str | None = Field(default=None, max_length=2000)
    task_count: int = Field(default=10, ge=0, le=1000)
    task_set_id: int | None = None
    takes_over_work: bool = False


class AgentUpdate(BaseModel):
    takes_over_work: bool


class AgentAnnotate(AnnotationFromTaskCreate):
    comment: str | None = Field(default=None, max_length=5000)


class AgentOut(BaseModel):
    agent_id: UUID
    name: str
    description: str | None
    campaign_id: int
    project_id: int
    assigned: int
    remaining: int
    takes_over_work: bool
    # When this agent last submitted or changed an annotation; None before its first one.
    last_active: datetime | None
    created_at: datetime


class AgentTaskOut(BaseModel):
    task_id: int
    annotation_number: int
    lat: float
    lon: float
    geometry_wkt: str


class NextTasksOut(BaseModel):
    campaign_id: int
    remaining: int
    # The first is the task to label now, the rest come after it so the caller can draw
    # them ahead. Empty once everything assigned is done.
    tasks: list[AgentTaskOut]


class AgentsOverviewOut(BaseModel):
    campaign_id: int
    name: str
    total_tasks: int
    # Campaign admins hand agents tasks from the open pool; other project members only
    # the tasks assigned to themselves.
    tasks_from: Literal["open_pool", "own_assignments"]
    # How many tasks the caller can still hand to new agents.
    open_tasks: int
    agents: list[AgentOut]


class ReleasedTasksOut(BaseModel):
    released: int
