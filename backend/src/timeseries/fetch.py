"""Pulling one point's index time series out of Earth Engine.

This is the only place an index formula meets real imagery. Sources have already
normalised band names and reflectance scaling, so nothing here is sensor-aware:
it evaluates the formula, asks Earth Engine for the values at a point, and shapes
the result. Failures surface as the domain errors below for the router to map.
"""

from dataclasses import dataclass
from typing import Any

import ee
import pandas as pd
from googleapiclient.errors import HttpError

from src.timeseries.indices import SpectralIndex
from src.timeseries.sources import TimeseriesSource, offers

_VALUE_BAND = "value"


class TimeseriesFetchError(Exception):
    """Base error for a failed Earth Engine time series fetch."""


class RateLimited(TimeseriesFetchError):
    """Earth Engine rejected the request due to rate limiting or quota."""


class UpstreamFailed(TimeseriesFetchError):
    """Earth Engine request failed for a reason other than rate limiting."""


@dataclass(frozen=True)
class _ImageTerm:
    """Adapts ``ee.Image`` to Python's arithmetic operators.

    Earth Engine exposes band math as named methods, not operators. Without this
    every index formula would have to be written twice - once against Earth
    Engine and once against the plain floats the tests check the maths on.
    Wrapping the image instead keeps indices.py free of Earth Engine entirely.
    """

    image: Any

    @staticmethod
    def _value(other: Any) -> Any:
        return other.image if isinstance(other, _ImageTerm) else other

    def __add__(self, other: Any) -> "_ImageTerm":
        return _ImageTerm(self.image.add(self._value(other)))

    def __sub__(self, other: Any) -> "_ImageTerm":
        return _ImageTerm(self.image.subtract(self._value(other)))

    def __mul__(self, other: Any) -> "_ImageTerm":
        return _ImageTerm(self.image.multiply(self._value(other)))

    def __truediv__(self, other: Any) -> "_ImageTerm":
        return _ImageTerm(self.image.divide(self._value(other)))

    # Addition and multiplication commute, so the reflected forms are the same
    # operation; subtraction and division are not and need the constant first.
    __radd__ = __add__
    __rmul__ = __mul__

    def __rsub__(self, other: Any) -> "_ImageTerm":
        return _ImageTerm(ee.Image.constant(other).subtract(self.image))

    def __rtruediv__(self, other: Any) -> "_ImageTerm":
        return _ImageTerm(ee.Image.constant(other).divide(self.image))


def index_image(image: Any, index: SpectralIndex) -> Any:
    """Evaluate an index formula against one prepared image, as a single band."""
    bands = {role: _ImageTerm(image.select(role)) for role in index.roles}
    return index.formula(bands).image.rename(_VALUE_BAND)


def _region_data_to_dataframe(region_data: list) -> pd.DataFrame:
    """Shape a getRegion() result (header row, then one row per observation) into
    the [time, values, cloud] frame the API returns.

    Rows with no value are dropped: those are pixels Earth Engine masked away,
    such as Landsat 7 scan-line gaps, and they are absent measurements rather
    than zeroes. Values are deliberately not clipped - a negative NDVI over water
    or a negative NBR over a burn scar is real, and each index declares the range
    the chart should show.
    """
    columns = region_data[0]
    df = pd.DataFrame(region_data[1:], columns=columns)
    if df.empty:
        return pd.DataFrame({"time": [], "values": [], "cloud": []})

    df["time"] = pd.to_datetime(df["time"], unit="ms")
    df = df.rename(columns={_VALUE_BAND: "values"})
    df = df.dropna(subset=["values"]).sort_values("time")
    df["cloud"] = df["cloud"].fillna(0).astype(int)

    return df[["time", "values", "cloud"]].reset_index(drop=True)


def fetch_index_series(
    source: TimeseriesSource,
    index: SpectralIndex,
    latitude: float,
    longitude: float,
    start_date: str,
    end_date: str,
) -> pd.DataFrame:
    """Index values and cloud flags at one point over a date range."""
    if not offers(source, index):
        raise ValueError(f"{source.key} cannot supply the bands {index.key} needs")

    point = ee.Geometry.Point([longitude, latitude])
    collection = source.build(start_date, end_date, point).map(
        lambda image: image.addBands(index_image(image, index))
    )

    # The EE client retries 429s with backoff internally; if it still fails we
    # surface a domain error rather than letting the raw stack trace propagate.
    try:
        region_data = (
            collection.select([_VALUE_BAND, "cloud"]).getRegion(point, source.scale_m).getInfo()
        )
    except (ee.EEException, HttpError) as exc:
        status = getattr(getattr(exc, "resp", None), "status", None)
        message = str(exc)
        if status == 429 or "429" in message or "quota" in message.lower():
            raise RateLimited(message) from exc
        raise UpstreamFailed(message) from exc

    return _region_data_to_dataframe(region_data)
