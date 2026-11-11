from datetime import date
from typing import Annotated, Any, Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    computed_field,
    field_validator,
    model_validator,
)
from pyproj import Geod
from shapely.geometry import LinearRing as ShapelyLinearRing
from shapely.geometry import shape
from shapely.validation import explain_validity

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
    """ISO date range from the first day of the start month to the first day after
    the end month, since Earth Engine's filterDate excludes its end date."""
    start_year, start_month = parse_ym(start_ym)
    end_year, end_month = parse_ym(end_ym)
    after_year, after_month = (end_year + 1, 1) if end_month == 12 else (end_year, end_month + 1)
    return (
        date(start_year, start_month, 1).isoformat(),
        date(after_year, after_month, 1).isoformat(),
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
    window_id: int
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
    name: str

    @field_validator("name")
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


# ============================================================================
# Zonal (polygon) series request
# ============================================================================

MAX_ZONE_AREA_KM2 = 50.0
MAX_ZONE_VERTICES = 1000
MAX_ZONE_PARTS = 10
# Earth Engine draws the edges straight in longitude/latitude, so a ring spanning more
# than half the globe goes the long way round, where a geodesic area would measure the
# short way across the antimeridian and undercount it.
MAX_ZONE_LONGITUDE_SPAN = 180.0

_GEOD = Geod(ellps="WGS84")

# [longitude, latitude]. A list rather than a tuple so the generated client accepts
# GeoJSON's number[] positions; the ranges are checked in _check_rings.
Position = Annotated[
    list[Annotated[float, Field(allow_inf_nan=False)]], Field(min_length=2, max_length=2)
]
LinearRing = Annotated[list[Position], Field(min_length=4)]
PolygonCoordinates = Annotated[list[LinearRing], Field(min_length=1)]


def _check_rings(polygons: list[list[list[list[float]]]]) -> None:
    for polygon in polygons:
        for ring in polygon:
            for longitude, latitude in ring:
                if not -180 <= longitude <= 180 or not -90 <= latitude <= 90:
                    raise ValueError(
                        "Positions must be [longitude, latitude] within [-180, 180] and [-90, 90]"
                    )
            if ring[0] != ring[-1]:
                raise ValueError("Each polygon ring must end at its first position")


def _ring_area_m2(ring: list[list[float]]) -> float:
    # Geod joins vertices with geodesics; short interpolated lon/lat segments
    # approximate the straight edges used by Earth Engine's geodesic=False.
    dense = ShapelyLinearRing(ring).segmentize(0.1)
    longitude, latitude = dense.coords.xy
    return abs(_GEOD.polygon_area_perimeter(longitude, latitude)[0])


class PolygonGeometry(BaseModel):
    type: Literal["Polygon"]
    coordinates: PolygonCoordinates

    @model_validator(mode="after")
    def rings_valid(self) -> "PolygonGeometry":
        _check_rings([self.coordinates])
        return self


class MultiPolygonGeometry(BaseModel):
    type: Literal["MultiPolygon"]
    coordinates: Annotated[list[PolygonCoordinates], Field(min_length=1, max_length=MAX_ZONE_PARTS)]

    @model_validator(mode="after")
    def rings_valid(self) -> "MultiPolygonGeometry":
        _check_rings(self.coordinates)
        return self


ZoneGeometry = Annotated[PolygonGeometry | MultiPolygonGeometry, Field(discriminator="type")]


class ZonalTimeseriesRequest(BaseModel):
    geometry: ZoneGeometry

    @model_validator(mode="after")
    def validate_zone(self) -> "ZonalTimeseriesRequest":
        polygons = (
            [self.geometry.coordinates]
            if isinstance(self.geometry, PolygonGeometry)
            else self.geometry.coordinates
        )
        vertices = sum(len(ring) for polygon in polygons for ring in polygon)
        if vertices > MAX_ZONE_VERTICES:
            raise ValueError(f"Polygon has {vertices} vertices; at most {MAX_ZONE_VERTICES}")

        longitudes = [position[0] for polygon in polygons for ring in polygon for position in ring]
        if max(longitudes) - min(longitudes) > MAX_ZONE_LONGITUDE_SPAN:
            raise ValueError(
                f"Polygon spans more than {MAX_ZONE_LONGITUDE_SPAN:g} degrees of longitude"
            )

        geom = shape(self.geometry_json())
        # Validity also rules out zero-area rings, holes outside their shell and
        # overlapping parts.
        if not geom.is_valid:
            raise ValueError(f"Polygon is not valid: {explain_validity(geom)}")

        area_km2 = (
            sum(
                _ring_area_m2(polygon[0]) - sum(_ring_area_m2(hole) for hole in polygon[1:])
                for polygon in polygons
            )
            / 1e6
        )
        if area_km2 > MAX_ZONE_AREA_KM2:
            raise ValueError(
                f"Polygon covers {area_km2:.1f} km2; at most {MAX_ZONE_AREA_KM2:g} km2"
            )
        return self

    def geometry_json(self) -> dict[str, Any]:
        return self.geometry.model_dump(mode="json")
