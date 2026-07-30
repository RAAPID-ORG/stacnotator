from calendar import monthrange
from datetime import date

from pydantic import BaseModel, ConfigDict, field_validator

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
# TimeSeries Related Schemas
# ============================================================================


class TimeSeriesCreate(BaseModel):
    name: str
    window_name: str = DEFAULT_TIMESERIES_WINDOW_NAME
    start_ym: str
    end_ym: str
    data_source: str
    provider: str
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


class TimeSeriesOut(TimeSeriesCreate):
    id: int
    campaign_id: int

    model_config = ConfigDict(from_attributes=True)


class TimeSeriesOptionsOut(BaseModel):
    data_sources: list[str]
    providers: list[str]
    ts_types: list[str]


# ============================================================================
# Specific Request / Response Schemas
# ============================================================================


class TimeseriesBulkCreateRequest(BaseModel):
    timeseries: list[TimeSeriesCreate]


class TimeseriesBulkCreateResponse(BaseModel):
    new_items: list[TimeSeriesOut]


class TimeseriesListResponse(BaseModel):
    items: list[TimeSeriesOut]


class TimeseriesDataResponse(BaseModel):
    timeseries_id: int
    data: list[dict]  # dataframe serialized as dict (orient="records")
