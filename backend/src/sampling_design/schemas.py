from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, RootModel

MAX_TASKS_PER_RUN = 10_000


class RandomSamplingConfig(BaseModel):
    """Draw independent uniform points across the region."""

    model_config = ConfigDict(extra="forbid")

    strategy_type: Literal["random"] = "random"
    num_samples: int = Field(..., gt=0, le=MAX_TASKS_PER_RUN)
    seed: int | None = Field(None, ge=0, description="Set for reproducible sampling")


class GridSamplingConfig(BaseModel):
    """Draw a regular lattice with the given spacing and one random offset."""

    model_config = ConfigDict(extra="forbid")

    strategy_type: Literal["grid"] = "grid"
    spacing_km: float = Field(
        ..., gt=0, allow_inf_nan=False, description="Distance between neighbouring points"
    )
    seed: int | None = Field(None, ge=0, description="Set for a reproducible grid offset")


class SamplingStrategy(
    RootModel[
        Annotated[RandomSamplingConfig | GridSamplingConfig, Field(discriminator="strategy_type")]
    ]
):
    """The strategy a client sends as a JSON string in the multipart form."""


class GenerateTasksResponse(BaseModel):
    """Response after generating tasks."""

    campaign_id: int
    num_tasks_created: int
    message: str
