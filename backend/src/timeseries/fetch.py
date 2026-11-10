"""Pulling a point's or a polygon's index time series out of Earth Engine.

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
_CLEAR_BAND = "clear"
# The zone cap in schemas.py keeps a series near 1e5 pixels per image; ten times that
# leaves room for boundary pixels without letting a reduction run away. bestEffort
# stays off so an oversized zone fails instead of being averaged at a coarser scale.
_ZONE_MAX_PIXELS = 1_000_000
_ZONE_TILE_SCALE = 2


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

    region_data = _get_info(
        collection.select([_VALUE_BAND, "cloud"]).getRegion(point, source.scale_m)
    )
    return _region_data_to_dataframe(region_data)


def _get_info(computed: Any) -> Any:
    # The EE client retries 429s with backoff internally; if it still fails we
    # surface a domain error rather than letting the raw stack trace propagate.
    try:
        return computed.getInfo()
    except (ee.EEException, HttpError) as exc:
        status = getattr(getattr(exc, "resp", None), "status", None)
        message = str(exc)
        if status == 429 or "429" in message or "quota" in message.lower():
            raise RateLimited(message) from exc
        raise UpstreamFailed(message) from exc


def zone_observation(image: Any, index: SpectralIndex, region: Any, scale_m: int) -> Any:
    # One feature per image: the area-weighted mean of the per-pixel index over the
    # zone's clear pixels, with cloud 0. Only when no clear pixel is left is it the
    # mean over every unmasked pixel, with cloud 1, so the chart's cloud filter hides
    # an image only when the whole zone is cloudy. value is null when the zone has no
    # unmasked pixel at all, and the caller drops those.
    value = index_image(image, index)
    clear = value.updateMask(image.select("cloud").eq(0)).rename(_CLEAR_BAND)
    means = ee.Dictionary(
        value.addBands(clear).reduceRegion(
            reducer=ee.Reducer.mean(),
            geometry=region,
            # Reduce in each image's own CRS at the source's resolution: a merged
            # Landsat record and Sentinel-2 tiles span UTM zones, and band math can
            # leave the index image's default projection ambiguous.
            crs=image.select(index.roles[0]).projection(),
            scale=scale_m,
            bestEffort=False,
            maxPixels=_ZONE_MAX_PIXELS,
            tileScale=_ZONE_TILE_SCALE,
        )
    )
    no_clear = ee.Algorithms.IsEqual(means.get(_CLEAR_BAND), None)
    return ee.Feature(
        None,
        {
            "time": image.get("system:time_start"),
            "value": ee.Algorithms.If(no_clear, means.get(_VALUE_BAND), means.get(_CLEAR_BAND)),
            "cloud": ee.Algorithms.If(no_clear, 1, 0),
        },
    )


def zone_series(
    source: TimeseriesSource,
    index: SpectralIndex,
    geometry: dict[str, Any],
    start_date: str,
    end_date: str,
) -> Any:
    if not offers(source, index):
        raise ValueError(f"{source.key} cannot supply the bands {index.key} needs")

    # GeoJSON edges are straight in longitude/latitude, which is how the map drew them.
    region = ee.Geometry(geometry, geodesic=False)
    observations = ee.FeatureCollection(
        source.build(start_date, end_date, region).map(
            lambda image: zone_observation(image, index, region, source.scale_m)
        )
    ).filter(ee.Filter.notNull(["value"]))
    return observations.reduceColumns(ee.Reducer.toList(3), ["time", "value", "cloud"]).get("list")


def _zone_rows_to_dataframe(rows: list) -> pd.DataFrame:
    df = pd.DataFrame(rows, columns=["time", "values", "cloud"])
    if df.empty:
        return pd.DataFrame({"time": [], "values": [], "cloud": []})
    df["time"] = pd.to_datetime(df["time"], unit="ms")
    df["cloud"] = df["cloud"].astype(int)
    return df.sort_values("time").reset_index(drop=True)


def fetch_zonal_index_series(
    source: TimeseriesSource,
    index: SpectralIndex,
    geometry: dict[str, Any],
    start_date: str,
    end_date: str,
) -> pd.DataFrame:
    return _zone_rows_to_dataframe(
        _get_info(zone_series(source, index, geometry, start_date, end_date))
    )
