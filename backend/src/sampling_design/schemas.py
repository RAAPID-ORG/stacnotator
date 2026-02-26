from pydantic import BaseModel, Field


class SamplingStrategyConfig(BaseModel):
    """Configuration for generating tasks using a sampling strategy."""

    strategy_type: str = Field(
        default="random",
        description="Type of sampling strategy: 'random', 'stratified_random', etc.",
    )
    num_samples: int = Field(..., gt=0, description="Number of samples to generate")
    parameters: dict | None = Field(
        None, description="Additional strategy-specific parameters (e.g., seed for random)"
    )
    use_campaign_bbox: bool = Field(
        default=False,
        description="If true, use the campaign's bounding box instead of a region file",
    )


class GenerateTasksResponse(BaseModel):
    """Response after generating tasks."""

    campaign_id: int
    num_tasks_created: int
    message: str
