from src.timeseries.ndvi_ee import ds_configs

# Derived from ds_configs so the supported-sources list can't drift from the
# sources Earth Engine science actually knows how to fetch.
SUPPORTED_TIMESERIES_SOURCES = tuple(ds_configs)
SUPPORTED_TIMESERIES_PROVIDERS = ("EE",)
SUPPORTED_TIMESERIES_TYPES = ("NDVI",)
