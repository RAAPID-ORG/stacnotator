from calendar import monthrange
from datetime import date

from pydantic import BaseModel, ConfigDict, computed_field, field_validator, model_validator

from src.timeseries.indices import INDICES, INDICES_BY_KEY, SpectralIndex, index_for, render_formula
from src.timeseries.sources import (
    SOURCES,
    TimeseriesSource,
    indices_for_source,
    offers,
    source_for,
)
from src.timeseries.windows import DEFAULT_TIMESERIES_WINDOW_NAME


def parse_ym(ym: str) -> tuple[int, int]:
    """Parse a YYYYMM string into (year, month); raises ValueError if malformed."""
    if len(ym) != 6 or not ym.isdigit():
        raise ValueError("Must be a 6-digit YYYYMM string (e.g. '202401')")
    year, month = int(ym[:4]), int(ym[4:6])
    if not 1 <= month <= 12:
        raise ValueError("Month must be between 01 and 12")
    return year, month


def ym_range_to_dates(start_ym: str, end_ym: str) -> tuple[str, str]:
    """ISO date range: first day of the start month to last day of the end month."""
    start_year, start_month = parse_ym(start_ym)
    end_year, end_month = parse_ym(end_ym)
    return (
        date(start_year, start_month, 1).isoformat(),
        date(end_year, end_month, monthrange(end_year, end_month)[1]).isoformat(),
    )


# ============================================================================
# Index and source descriptions
# ============================================================================


class SpectralIndexOut(BaseModel):
    """An index as the UI needs it: how to label and plot it, and the formula it
    computes, rendered from the callable itself so the two cannot disagree."""

    key: str
    label: str
    formula: str
    domain_min: float
    domain_max: float
    reference_lines: list[float]


class TimeseriesSourceOut(BaseModel):
    key: str
    label: str
    description: str
    coverage: str
    resolution_m: int
    # Which indices this source can actually compute, derived from its bands.
    index_keys: list[str]


def index_out(index: SpectralIndex) -> SpectralIndexOut:
    return SpectralIndexOut(
        key=index.key,
        label=index.label,
        formula=render_formula(index),
        domain_min=index.domain[0],
        domain_max=index.domain[1],
        reference_lines=list(index.reference_lines),
    )


def source_out(source: TimeseriesSource) -> TimeseriesSourceOut:
    return TimeseriesSourceOut(
        key=source.key,
        label=source.label,
        description=source.description,
        coverage=source.coverage,
        resolution_m=source.scale_m,
        index_keys=[index.key for index in indices_for_source(source)],
    )


# ============================================================================
# Timeseries Related Schemas
# ============================================================================


class TimeseriesCreate(BaseModel):
    name: str
    window_name: str = DEFAULT_TIMESERIES_WINDOW_NAME
    start_ym: str
    end_ym: str
    data_source: str
    ts_type: str

    @field_validator("window_name")
    @classmethod
    def normalize_window_name(cls, v: str) -> str:
        return v.strip() or DEFAULT_TIMESERIES_WINDOW_NAME

    @field_validator("start_ym", "end_ym")
    @classmethod
    def validate_ym(cls, v: str) -> str:
        parse_ym(v)
        return v

    @model_validator(mode="after")
    def validate_source_and_index(self) -> "TimeseriesCreate":
        """Reject a combination the source cannot compute, and store the canonical
        keys. Catching this here means a series can never be saved only to fail
        every time an annotator opens it."""
        source = source_for(self.data_source)
        if source is None:
            raise ValueError(f"Unsupported data source: {self.data_source}")

        index = index_for(self.ts_type)
        if index is None:
            raise ValueError(f"Unknown index: {self.ts_type}")

        if not offers(source, index):
            raise ValueError(f"{source.label} does not carry the bands {index.label} needs")

        self.data_source = source.key
        self.ts_type = index.key
        return self


class TimeseriesOut(BaseModel):
    """What comes back carries the resolved index description besides the keys."""

    id: int
    campaign_id: int
    name: str
    window_name: str
    start_ym: str
    end_ym: str
    data_source: str
    ts_type: str

    model_config = ConfigDict(from_attributes=True)

    @computed_field  # type: ignore[prop-decorator]
    @property
    def index(self) -> SpectralIndexOut:
        """The index this series plots, so the chart can scale its axis and
        explain itself without a second request."""
        return index_out(INDICES_BY_KEY[self.ts_type])


class TimeseriesOptionsOut(BaseModel):
    sources: list[TimeseriesSourceOut]
    indices: list[SpectralIndexOut]


def timeseries_options() -> TimeseriesOptionsOut:
    return TimeseriesOptionsOut(
        sources=[source_out(source) for source in SOURCES],
        indices=[index_out(index) for index in INDICES],
    )


# ============================================================================
# Specific Request / Response Schemas
# ============================================================================


class TimeseriesBulkCreateRequest(BaseModel):
    timeseries: list[TimeseriesCreate]


class TimeseriesWindowRenameRequest(BaseModel):
    old_name: str
    new_name: str

    @field_validator("old_name", "new_name")
    @classmethod
    def validate_window_name(cls, value: str) -> str:
        name = value.strip()
        if not name:
            raise ValueError("Window name must not be empty")
        return name


class TimeseriesBulkCreateResponse(BaseModel):
    new_items: list[TimeseriesOut]


class TimeseriesDataResponse(BaseModel):
    timeseries_id: int
    data: list[dict]  # dataframe serialized as dict (orient="records")
