from typing import Annotated, Literal

from pydantic import BaseModel, Field, TypeAdapter

MAX_TASKS_PER_RUN = 10_000


class RandomSamplingConfig(BaseModel):
    """Draw independent uniform points across the region."""

    strategy_type: Literal["random"] = "random"
    num_samples: int = Field(..., gt=0, le=MAX_TASKS_PER_RUN)
    seed: int | None = Field(None, ge=0, description="Set for reproducible sampling")


class GridSamplingConfig(BaseModel):
    """Draw a regular lattice with the given spacing and one random offset."""

    strategy_type: Literal["grid"] = "grid"
    spacing_km: float = Field(
        ..., gt=0, allow_inf_nan=False, description="Distance between neighbouring points"
    )
    seed: int | None = Field(None, ge=0, description="Set for a reproducible grid offset")


SamplingStrategy = Annotated[
    RandomSamplingConfig | GridSamplingConfig,
    Field(discriminator="strategy_type"),
]

_strategy_adapter: TypeAdapter[RandomSamplingConfig | GridSamplingConfig] = TypeAdapter(
    SamplingStrategy
)


def parse_sampling_strategy(raw: str) -> RandomSamplingConfig | GridSamplingConfig:
    """Validate the strategy JSON a client sends as a multipart form field."""
    return _strategy_adapter.validate_json(raw)


class GenerateTasksResponse(BaseModel):
    """Response after generating tasks."""

    campaign_id: int
    num_tasks_created: int
    message: str
