from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class PlanetCredentials(BaseModel):
    """Which Planet key to browse with, and for which project.

    Sent in a request body rather than a query string: a pasted key is a secret, and
    query strings end up in access logs. Same either/or as ``ApiKeyUpdate`` - the
    organization's shared key, or one this person is providing for their own campaign.
    """

    project_id: int
    organization_api_key_id: int | None = None
    api_key: str | None = Field(default=None, min_length=1)

    @model_validator(mode="after")
    def exactly_one_source(self) -> "PlanetCredentials":
        if (self.api_key is None) == (self.organization_api_key_id is None):
            raise ValueError("Set exactly one of api_key or organization_api_key_id")
        return self


class PlanetSeriesOut(BaseModel):
    """A named temporal cadence of basemaps (e.g. global monthly)."""

    id: str
    name: str
    description: str | None = None


class PlanetMosaicOut(BaseModel):
    """One mosaic of a series: a fixed time window with ready-made tiles."""

    id: str
    name: str
    first_acquired: str
    last_acquired: str
    # Storable ``{api_key}`` templates keyed by visualization name. Planet's own
    # link carries the live key, so it is never what we return.
    tile_urls: dict[str, str] = {}
    # Set when the mosaic cannot become a slice. It stays in the listing, shown
    # disabled, rather than vanishing without explanation.
    unavailable_reason: str | None = None


class PlanetSeriesMosaicsOut(BaseModel):
    series_id: str
    # Visualization names every mosaic in this series offers, in display order.
    renderings: list[str]
    # Deepest zoom Planet serves for this series, from its ground resolution.
    max_native_zoom: int | None = None
    mosaics: list[PlanetMosaicOut]


class PlanetScenesGenerationConfigV1(BaseModel):
    """Lossless, versioned input for a Planet scene-stack source.

    Saved on the source's generation series the way the STAC generator's config is, so
    the source can be regenerated later without anyone remembering what was searched.
    """

    kind: Literal["planet_scenes"]
    version: Literal[1] = 1
    aoi: dict
    item_types: list[str] = ["PSScene"]
    start_date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    end_date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    collection_period_interval: int = Field(ge=1)
    collection_period_unit: Literal["days", "weeks", "months", "years"]
    slice_period_interval: int = Field(ge=1)
    slice_period_unit: Literal["days", "weeks", "months", "years"]
    # Stacks the whole window into a cover of its own, the way a STAC cover search
    # does. Without it the window opens on its first slice.
    whole_window_cover: bool
    # At 100 the filter is omitted entirely, so items carrying no cloud metadata are
    # not silently dropped. See client._scene_filters.
    max_cloud_cover: float = Field(default=100, ge=0, le=100)
    quality_categories: list[str] = ["standard"]

    model_config = ConfigDict(extra="forbid")

    @model_validator(mode="after")
    def dates_are_ordered(self) -> "PlanetScenesGenerationConfigV1":
        if self.end_date < self.start_date:
            raise ValueError("end_date must not precede start_date")
        return self


class PlanetSceneGroupOut(BaseModel):
    """One window or slice as previewed: what it covers, and how much imagery it has."""

    start_date: str
    end_date: str
    scene_count: int


class PlanetSceneWindowOut(BaseModel):
    start_date: str
    end_date: str
    # Set under whole_window_cover.
    cover: PlanetSceneGroupOut | None = None
    slices: list[PlanetSceneGroupOut]


class PlanetScenePreview(BaseModel):
    credentials: PlanetCredentials
    config: PlanetScenesGenerationConfigV1
