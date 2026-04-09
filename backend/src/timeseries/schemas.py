from pydantic import BaseModel, ConfigDict, field_validator

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

    @field_validator("start_ym", "end_ym")
    @classmethod
    def validate_ym(cls, v: str) -> str:
        if not v or len(v) != 6 or not v.isdigit():
            raise ValueError("Must be a 6-digit YYYYMM string (e.g. '202401')")
        month = int(v[4:6])
        if month < 1 or month > 12:
            raise ValueError("Month must be between 01 and 12")
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
