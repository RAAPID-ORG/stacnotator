"""Shapes shared by the API, the worker and the records the workspace keeps on disk.

Everything a job produces is plain data, so the same models describe a request,
the record written next to the map on the worker, and the response the client
polls for. Keeping them in one place is what lets a job run in another process
later without a second set of shapes.
"""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

# Every value a map may hold has to fit the strata raster's dtype with one value
# left over to mark pixels that carry no class at all.
STRATA_DTYPE = "uint16"
NODATA = 65535
MAX_VALUE = NODATA - 1

MAX_SOURCES_PER_MAP = 64
MAX_AREAS = 500
MAX_CLASSES = 200

JobKind = Literal["preprocess", "stratify"]
JobStatus = Literal["queued", "running", "done", "failed"]
SourceKind = Literal["upload", "url"]


class BandInfo(BaseModel):
    index: int
    dtype: str
    description: str | None
    # The file's own nodata. Reported, and counted like any other value inside
    # the footprint, so the design can still decide what to do with it.
    nodata: float | None


class Bbox(BaseModel):
    west: float
    south: float
    east: float
    north: float


class SourceInfo(BaseModel):
    """What one file says about itself, read from its header only."""

    name: str
    width: int
    height: int
    crs: str
    crs_name: str
    is_geographic: bool
    is_equal_area: bool
    # In the file's own units; metres only when the CRS is projected in metres.
    resolution: tuple[float, float]
    pixel_area_m2: float | None
    bbox: Bbox
    bands: list[BandInfo]


class MapInfo(BaseModel):
    """One map, possibly in several tiles that together cover the region."""

    sources: list[SourceInfo]
    bands: list[BandInfo]
    bbox: Bbox
    total_pixels: int
    is_equal_area: bool
    # The projection the census is proposed in: the map's own when it already
    # preserves area, else a Lambert azimuthal equal-area centred on its extent.
    proposed_crs: str


class SourceRef(BaseModel):
    kind: SourceKind
    # The file name a person uploaded, or the URL they linked.
    name: str
    # Where the worker reads it from: a file in the map's directory for an upload,
    # the URL itself for a link. Only uploads are ever stored.
    location: str


class StudyArea(BaseModel):
    id: str
    name: str
    feature_count: int


class AreaSet(BaseModel):
    """Areas of interest, kept as EPSG:4326 GeoJSON features beside the map."""

    file_name: str
    areas: list[StudyArea]


class GridSpec(BaseModel):
    """The equal-area grid every pixel is counted on."""

    crs: str
    resolution_m: float
    width: int
    height: int
    # Affine coefficients in GDAL order, so the grid round-trips through JSON.
    transform: tuple[float, float, float, float, float, float]

    @property
    def pixel_area_m2(self) -> float:
        return self.resolution_m * self.resolution_m


class PreprocessRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    band: int = Field(1, ge=1)
    # Any PROJ string, WKT or authority code, checked to preserve area before a
    # single pixel is read.
    crs: str = Field(..., min_length=1)
    # Unset: the resolution GDAL derives from the first source, which keeps the
    # pixel count close to the original.
    resolution_m: float | None = Field(None, gt=0, allow_inf_nan=False)


class RawCensus(BaseModel):
    """Pixels per map value, on the equal-area grid, inside the map's footprint.

    ``total`` covers the whole footprint; ``by_area`` one entry per area of
    interest. A pixel is in an area when its centre is, so with areas that do not
    overlap every pixel is counted at most once.
    """

    grid: GridSpec
    band: int
    total: dict[int, int]
    by_area: dict[str, dict[int, int]]
    footprint_pixels: int
    # Inside the footprint but without a usable value: NaN, or the file's declared
    # nodata when that value cannot be represented as a class.
    masked_pixels: int
    declared_nodata: list[int]


class ReportingClass(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(..., min_length=1)
    values: list[int] = Field(..., min_length=1)


class StratifyRequest(BaseModel):
    """How map values fold into strata. Every value the census saw must land in
    exactly one class or be declared nodata; anything else is an error, since a
    pixel silently dropped or double-counted breaks the stratum weights."""

    model_config = ConfigDict(extra="forbid")

    classes: list[ReportingClass] = Field(..., min_length=1, max_length=MAX_CLASSES)
    nodata_values: list[int] = Field(default_factory=list)

    @model_validator(mode="after")
    def _values_assigned_once(self) -> "StratifyRequest":
        seen: dict[int, str] = {}
        for cls in self.classes:
            for value in cls.values:
                if not 0 <= value <= MAX_VALUE:
                    raise ValueError(f"map value {value} is outside 0..{MAX_VALUE}")
                if value in seen:
                    raise ValueError(f"map value {value} is in both {seen[value]!r} and {cls.id!r}")
                seen[value] = cls.id
        for value in self.nodata_values:
            if value in seen:
                raise ValueError(f"map value {value} is both nodata and in {seen[value]!r}")
        if len(set(cls.id for cls in self.classes)) != len(self.classes):
            raise ValueError("class ids must be unique")
        return self


class StrataCensus(BaseModel):
    """Pixels per stratum, keyed by class id, plus the code each class holds in
    the strata raster (1-based, in request order)."""

    grid: GridSpec
    codes: dict[str, int]
    total: dict[str, int]
    by_area: dict[str, dict[str, int]]
    nodata_pixels: int


class PreprocessProduct(BaseModel):
    spec: PreprocessRequest
    census: RawCensus
    path: str


class StrataProduct(BaseModel):
    spec: StratifyRequest
    census: StrataCensus
    path: str


class MapRecord(BaseModel):
    """The record kept beside a map on the worker. Products are the latest run
    of each step; a new run replaces the previous one."""

    id: str
    campaign_id: int
    created_at: datetime
    sources: list[SourceRef]
    info: MapInfo
    areas: AreaSet | None = None
    preprocess: PreprocessProduct | None = None
    strata: StrataProduct | None = None
    active_job_id: str | None = None


class JobRecord(BaseModel):
    id: str
    campaign_id: int
    map_id: str
    kind: JobKind
    spec: PreprocessRequest | StratifyRequest
    status: JobStatus
    created_at: datetime
    heartbeat_at: datetime
    finished_at: datetime | None = None
    # 0..1, windows written over windows planned.
    progress: float = 0.0
    error: str | None = None
    result: RawCensus | StrataCensus | None = None


class MapOut(BaseModel):
    id: str
    created_at: datetime
    sources: list[SourceRef]
    info: MapInfo
    areas: AreaSet | None
    preprocess: PreprocessProduct | None
    strata: StrataProduct | None
    active_job_id: str | None


class JobOut(BaseModel):
    id: str
    map_id: str
    kind: JobKind
    status: JobStatus
    progress: float
    error: str | None
    result: RawCensus | StrataCensus | None


class LinkMapRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    urls: list[str] = Field(..., min_length=1, max_length=MAX_SOURCES_PER_MAP)
