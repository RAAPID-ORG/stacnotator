"""How a campaign's time series map onto canvas windows: every series is charted in
one window (a ``TimeseriesWindow`` row), and the grid keys that window by its id."""

# Where a series lands when it names no window of its own.
DEFAULT_TIMESERIES_WINDOW_NAME = "Time series"
TIMESERIES_WINDOW_KEY_PREFIX = "timeseries:"


def window_grid_key(window_id: int) -> str:
    return f"{TIMESERIES_WINDOW_KEY_PREFIX}{window_id}"
