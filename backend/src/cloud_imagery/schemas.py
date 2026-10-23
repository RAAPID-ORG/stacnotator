from datetime import UTC, date, datetime, time
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

from src.imagery.schemas import VizParamsCreate
from src.stac_browser.schemas import AssetInfo
from src.storage_access import StorageAccessCreate, StorageAccessOut

CollectionStatus = Literal["draft", "importing", "ready", "failed"]
ImportStatus = Literal["registering", "ready", "failed"]
BandName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]


class Visualization(BaseModel):
    """A preset suggested to campaigns; a campaign copies it, there is no live link."""

    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=100)
    viz_params: VizParamsCreate


class CollectionCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str = Field(min_length=1, max_length=200)
    project_id: int = Field(gt=0)
    tiler: str = Field(min_length=1, max_length=64)
    container_url: str = Field(min_length=1, max_length=2048)
    prefix: str = Field(default="", max_length=1024)
    storage_access: StorageAccessCreate
    data_region: str | None = Field(default=None, max_length=64)
    visualizations: list[Visualization] = Field(default_factory=list)


class CollectionUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str | None = Field(default=None, min_length=1, max_length=200)
    visualizations: list[Visualization] | None = None
    storage_access: StorageAccessCreate | None = None
    band_names: dict[str, list[BandName]] | None = None


class CollectionOut(BaseModel):
    id: int
    title: str
    project_id: int
    status: CollectionStatus
    tiler: str
    container_url: str
    prefix: str
    storage_access: StorageAccessOut | None
    data_region: str | None
    tiler_region: str | None
    visualizations: list[Visualization]
    bbox: list[float] | None
    interval: list[str | None] | None
    item_count: int | None
    import_id: int | None
    # Legacy default for ungrouped files; item_assets describes the actual catalog.
    asset_key: str = "data"
    item_assets: dict[str, AssetInfo] = {}


class CollectionList(BaseModel):
    items: list[CollectionOut]


class DiscoveredObject(BaseModel):
    path: str
    etag: str
    size: int


class DiscoverOut(BaseModel):
    objects: list[DiscoveredObject]
    next_cursor: str | None


_Moment = datetime


def _when(value: str, *, end: bool) -> datetime:
    """An aware timestamp; a bare date is that whole UTC day."""
    if len(value) == 10:
        day = date.fromisoformat(value)
        return datetime.combine(day, time.max if end else time.min, tzinfo=UTC)
    parsed = datetime.fromisoformat(value)
    if parsed.tzinfo is None:
        raise ValueError(f"{value!r} needs a timezone (for example a trailing Z)")
    return parsed.astimezone(UTC)


class FileSelection(BaseModel):
    model_config = ConfigDict(extra="forbid")

    path: str = Field(min_length=1, max_length=1024)
    etag: str = Field(min_length=1, max_length=256)
    datetime: str | None = None
    start_datetime: str | None = None
    end_datetime: str | None = None
    # Files sharing an item_key are one STAC item, each under its own asset_key.
    item_key: str | None = Field(default=None, min_length=1, max_length=128)
    asset_key: str = Field(default="data", pattern=r"^[A-Za-z0-9_.-]{1,128}$")
    band_names: list[BandName] | None = Field(default=None, min_length=1, max_length=64)

    @model_validator(mode="after")
    def one_time_form(self) -> "FileSelection":
        bounds = (self.start_datetime, self.end_datetime)
        if self.datetime is not None:
            if bounds != (None, None):
                raise ValueError("Give either datetime or start_datetime/end_datetime")
            _when(self.datetime, end=False)
        elif None in bounds:
            raise ValueError("Give datetime, or both start_datetime and end_datetime")
        elif self.span()[0] > self.span()[1]:
            raise ValueError("start_datetime must not be after end_datetime")
        return self

    @property
    def instant(self) -> bool:
        return self.datetime is not None

    def span(self) -> "tuple[_Moment, _Moment]":
        if self.datetime is not None:
            moment = _when(self.datetime, end=False)
            return moment, moment
        if self.start_datetime is None or self.end_datetime is None:
            raise ValueError("A file needs a datetime or a start and end")
        return _when(self.start_datetime, end=False), _when(self.end_datetime, end=True)


class ImportCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    files: list[FileSelection] = Field(min_length=1, max_length=10000)

    @model_validator(mode="after")
    def unique_paths(self) -> "ImportCreate":
        paths = [f.path for f in self.files]
        if len(set(paths)) != len(paths):
            raise ValueError("Each path may be selected once")
        items: dict[str, list[FileSelection]] = {}
        for f in self.files:
            if f.item_key is not None:
                items.setdefault(f.item_key, []).append(f)
        for key, group in items.items():
            if len({f.asset_key for f in group}) != len(group):
                raise ValueError(f"Item {key!r} has the same asset key twice")
            if len(group) > 64:
                raise ValueError(f"Item {key!r} has more than 64 assets")
            if len({(f.instant, f.span()) for f in group}) != 1:
                raise ValueError(f"Every asset of item {key!r} needs the same time")
        return self


class ImportIssue(BaseModel):
    code: str
    path: str | None
    message: str


class ImportOut(BaseModel):
    id: int
    collection_id: int
    status: ImportStatus
    total: int
    completed: int
    errors: list[ImportIssue]
    retryable: bool
