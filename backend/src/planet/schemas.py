from pydantic import BaseModel, Field, model_validator


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
