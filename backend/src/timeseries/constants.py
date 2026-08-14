from src.timeseries.ndvi_ee import TimeseriesSource, ds_configs

# Derived from ds_configs so the supported-sources list can't drift from the
# sources Earth Engine science actually knows how to fetch.
SUPPORTED_TIMESERIES_SOURCES: tuple[TimeseriesSource, ...] = tuple(ds_configs)


def as_timeseries_source(value: str) -> TimeseriesSource | None:
    """The requested source as one of the supported ones, or None. Matching
    against the registry itself keeps the check derived rather than a second
    hand-written list."""
    wanted = value.strip().upper()
    for source in SUPPORTED_TIMESERIES_SOURCES:
        if source == wanted:
            return source
    return None


SUPPORTED_TIMESERIES_PROVIDERS = ("EE",)
SUPPORTED_TIMESERIES_TYPES = ("NDVI",)
