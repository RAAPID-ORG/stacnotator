"""Where a time series' pixels come from: one entry per satellite source.

A source builds an ``ee.ImageCollection`` whose bands are already named by band
role and already scaled to surface reflectance, plus a 0/1 ``cloud`` band.
Everything sensor-specific - collection ids, band names, scaling factors, how
clouds are flagged, the fact that Landsat is four missions merged - is absorbed
here. That is what lets one index formula run unchanged across all of them, and
it is why the extraction in fetch.py needs to know nothing about satellites.
"""

from collections.abc import Callable
from dataclasses import dataclass
from functools import reduce
from typing import Any

import ee

from src.timeseries.indices import INDICES, BandRole, SpectralIndex

SUPPORTED_TIMESERIES_PROVIDERS = ("EE",)


@dataclass(frozen=True)
class TimeseriesSource:
    """One satellite source, and the prose a campaign designer needs to choose
    between them. ``roles`` is what an index is checked against, so a source can
    only ever offer indices it can actually compute."""

    key: str
    label: str
    roles: frozenset[BandRole]
    # Native resolution to sample at; also what getRegion is asked for.
    scale_m: int
    coverage: str
    description: str
    build: Callable[[str, str, Any], Any]


def _filtered(collection_id: str, start_date: str, end_date: str, point: Any) -> Any:
    return ee.ImageCollection(collection_id).filterDate(start_date, end_date).filterBounds(point)


def _to_reflectance(
    image: Any, bands: dict[BandRole, str], scale: float, offset: float = 0.0
) -> Any:
    """Select the bands this source offers, rename them to their roles, and
    convert the packed integers to reflectance. Renaming here is what makes the
    rest of the pipeline sensor-agnostic."""
    roles = list(bands)
    return image.select([bands[role] for role in roles], roles).multiply(scale).add(offset)


def _stamp(prepared: Any, source: Any) -> Any:
    """Carry the acquisition time across, since band math drops properties and
    getRegion reads the timestamp off the image."""
    return prepared.set("system:time_start", source.get("system:time_start"))


# ---------------------------------------------------------------------------
# MODIS - MOD09Q1, 8-day composites, red and NIR only
# ---------------------------------------------------------------------------

_MODIS_BANDS: dict[BandRole, str] = {"red": "sur_refl_b01", "nir": "sur_refl_b02"}
_MODIS_SCALE = 0.0001


def _modis_collection(start_date: str, end_date: str, point: Any) -> Any:
    def prepare(image: Any) -> Any:
        # State bits 0-1: 0 clear, 1 cloudy, 2 mixed, 3 not set (assumed clear).
        cloud_state = image.select("State").toUint16().bitwiseAnd(3)
        cloud = cloud_state.eq(1).Or(cloud_state.eq(2)).rename("cloud")
        reflectance = _to_reflectance(image, _MODIS_BANDS, _MODIS_SCALE)
        return _stamp(reflectance.addBands(cloud), image)

    return _filtered("MODIS/061/MOD09Q1", start_date, end_date, point).map(prepare)


# ---------------------------------------------------------------------------
# Sentinel-2 - L2A surface reflectance, CloudScore+ masking
# ---------------------------------------------------------------------------

_S2_BANDS: dict[BandRole, str] = {
    "blue": "B2",
    "green": "B3",
    "red": "B4",
    "rededge1": "B5",
    "nir": "B8",
    "nir08": "B8A",
    "swir1": "B11",
    "swir2": "B12",
}
_S2_SCALE = 1 / 10000
# CloudScore+ cs_cdf runs 0 (cloudy) to 1 (clear); 0.65 is Google's recommended
# default for vegetation time series.
_CS_CLEAR_THRESHOLD = 0.65
# Scene Classification codes CloudScore+ does not reliably flag on its own.
_SCL_CLOUD_CLASSES = [3, 8, 9, 10]  # shadow, cloud medium, cloud high, cirrus


def _link_cloudscore_plus(collection: Any) -> Any:
    """Attach the CloudScore+ cs_cdf band to each scene. This is an inner join,
    so scenes without a CloudScore+ match drop out rather than going unmasked."""
    matched = ee.Join.saveFirst("cs_match").apply(
        collection,
        ee.ImageCollection("GOOGLE/CLOUD_SCORE_PLUS/V1/S2_HARMONIZED"),
        ee.Filter.equals(leftField="system:index", rightField="system:index"),
    )
    return ee.ImageCollection(matched).map(
        lambda image: image.addBands(ee.Image(image.get("cs_match")).select("cs_cdf"))
    )


def _sentinel2_collection(start_date: str, end_date: str, point: Any) -> Any:
    collection = _link_cloudscore_plus(
        _filtered("COPERNICUS/S2_SR_HARMONIZED", start_date, end_date, point)
    )

    def prepare(image: Any) -> Any:
        scored = image.select("cs_cdf").lt(_CS_CLEAR_THRESHOLD)
        classified = image.select("SCL").remap(_SCL_CLOUD_CLASSES, [1] * len(_SCL_CLOUD_CLASSES), 0)
        cloud = scored.Or(classified).rename("cloud")
        reflectance = _to_reflectance(image, _S2_BANDS, _S2_SCALE)
        return _stamp(reflectance.addBands(cloud), image)

    return collection.map(prepare)


# ---------------------------------------------------------------------------
# Landsat - four missions merged into one 30 m record
# ---------------------------------------------------------------------------

_LANDSAT_TM_BANDS: dict[BandRole, str] = {
    "blue": "SR_B1",
    "green": "SR_B2",
    "red": "SR_B3",
    "nir": "SR_B4",
    "swir1": "SR_B5",
    "swir2": "SR_B7",
}
_LANDSAT_OLI_BANDS: dict[BandRole, str] = {
    "blue": "SR_B2",
    "green": "SR_B3",
    "red": "SR_B4",
    "nir": "SR_B5",
    "swir1": "SR_B6",
    "swir2": "SR_B7",
}
_LANDSAT_SCALE = 0.0000275
_LANDSAT_OFFSET = -0.2
# QA_PIXEL bits 1 dilated cloud, 2 cirrus, 3 cloud, 4 cloud shadow. Bit 2 is
# unused (and so always 0) before Landsat 8, which makes one mask correct for
# every mission.
_LANDSAT_CLOUD_BITS = 0b11110
_LANDSAT_FILL_BIT = 0b1

LANDSAT_MISSIONS: tuple[tuple[str, dict[BandRole, str]], ...] = (
    ("LANDSAT/LT05/C02/T1_L2", _LANDSAT_TM_BANDS),
    ("LANDSAT/LE07/C02/T1_L2", _LANDSAT_TM_BANDS),
    ("LANDSAT/LC08/C02/T1_L2", _LANDSAT_OLI_BANDS),
    ("LANDSAT/LC09/C02/T1_L2", _LANDSAT_OLI_BANDS),
)


def _landsat_prepare(bands: dict[BandRole, str]) -> Callable[[Any], Any]:
    def prepare(image: Any) -> Any:
        qa = image.select("QA_PIXEL")
        cloud = qa.bitwiseAnd(_LANDSAT_CLOUD_BITS).neq(0).rename("cloud")
        reflectance = _to_reflectance(image, bands, _LANDSAT_SCALE, _LANDSAT_OFFSET)
        # Fill pixels carry no measurement at all, so they are masked away rather
        # than reported as cloudy - this is also where Landsat 7's scan-line gaps go.
        valid = qa.bitwiseAnd(_LANDSAT_FILL_BIT).eq(0)
        return _stamp(reflectance.addBands(cloud).updateMask(valid), image)

    return prepare


def _landsat_collection(start_date: str, end_date: str, point: Any) -> Any:
    """One collection spanning every mission. Band names differ by generation, so
    each is renamed to its roles before the merge - after that they are one
    series and nothing downstream knows which satellite a value came from."""
    per_mission = [
        _filtered(collection_id, start_date, end_date, point).map(_landsat_prepare(bands))
        for collection_id, bands in LANDSAT_MISSIONS
    ]
    return reduce(lambda merged, mission: merged.merge(mission), per_mission)


SOURCES: tuple[TimeseriesSource, ...] = (
    TimeseriesSource(
        key="SENTINEL2",
        label="Sentinel-2",
        roles=frozenset(_S2_BANDS),
        scale_m=10,
        coverage="2017 to present",
        description=(
            "Surface reflectance at 10 to 20 m with a revisit of about five days. The "
            "finest detail of the three sources and the only one carrying red edge "
            "bands, at the cost of the shortest archive."
        ),
        build=_sentinel2_collection,
    ),
    TimeseriesSource(
        key="LANDSAT",
        label="Landsat 5/7/8/9",
        roles=frozenset(_LANDSAT_OLI_BANDS),
        scale_m=30,
        coverage="1984 to present",
        description=(
            "Four missions merged into a single 30 m record, revisit 8 to 16 days. The "
            "only source reaching back to 1984, which is what makes decade-scale change "
            "visible. Landsat 7 scenes after mid-2003 carry scan-line gaps, so some "
            "dates return no value at a given point."
        ),
        build=_landsat_collection,
    ),
    TimeseriesSource(
        key="MODIS",
        label="MODIS",
        roles=frozenset(_MODIS_BANDS),
        scale_m=250,
        coverage="2000 to present",
        description=(
            "Eight-day surface reflectance composites at 250 m. Coarse, but dense and "
            "consistent, which suits regional seasonality over long records. This "
            "product carries only red and near-infrared, so only the two-band "
            "vegetation indices are available."
        ),
        build=_modis_collection,
    ),
)

SOURCES_BY_KEY: dict[str, TimeseriesSource] = {source.key: source for source in SOURCES}


def source_for(key: str) -> TimeseriesSource | None:
    """The source registered under `key`, or None. Matching is case- and
    padding-insensitive so a stored value survives hand-editing."""
    return SOURCES_BY_KEY.get(key.strip().upper())


def offers(source: TimeseriesSource, index: SpectralIndex) -> bool:
    """A source offers an index exactly when it can supply every band the
    formula reads. Nothing lists compatible pairs by hand."""
    return set(index.roles) <= source.roles


def indices_for_source(source: TimeseriesSource) -> tuple[SpectralIndex, ...]:
    return tuple(index for index in INDICES if offers(source, index))
