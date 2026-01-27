from pydantic import BaseModel
from typing import Dict, List


# ============================================================================
# TimeSeries Related Schemas
# ============================================================================


class TimeSeriesCreate(BaseModel):
    name: str
    start_ym: str
    end_ym: str
    data_source: str
    provider: str
    ts_type: str


class TimeSeriesOut(TimeSeriesCreate):
    id: int
    campaign_id: int

    class Config:
        from_attributes = True


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
    data: List[Dict]  # dataframe serialized as dict (orient="records")
