"""Earth Engine NDVI time series science: cloud masking, CloudScore+ linking,
and per-point dataframe extraction. No FastAPI or database dependency here;
failures surface as the domain errors below for the router to translate.
"""

import ee
import pandas as pd
from googleapiclient.errors import HttpError


class NdviFetchError(Exception):
    """Base error for a failed Earth Engine NDVI fetch."""


class RateLimited(NdviFetchError):
    """Earth Engine rejected the request due to rate limiting or quota."""


class UpstreamFailed(NdviFetchError):
    """Earth Engine request failed for a reason other than rate limiting."""


def add_ndvi_band_to_ee_image(image: ee.Image, nir: str, red: str, name: str = "NDVI") -> ee.Image:
    """
    Add an NDVI band to an Image, given red and nir band names
    """
    ndvi = image.normalizedDifference([nir, red]).rename(name)
    return image.addBands(ndvi)


def add_modis_cloud_mask(image):
    """
    Add a cloud mask for MODIS MOD09Q1 imagery based on the 'State' band.
    Bits 0-1: cloud state (00=clear, 01=cloudy, 10=mixed, 11=not set).
    """
    cloud_bits = image.select("State").toUint16().bitwiseAnd(3)  # bits 0-1
    is_cloud = cloud_bits.eq(1).Or(cloud_bits.eq(2))  # Cloudy or Mixed
    cloud_mask = ee.Image(is_cloud).rename("cloud")
    return image.addBands(cloud_mask)


def add_s2_cloud_mask(image):
    """
    Add a cloud mask for Sentinel-2 combining Google CloudScore+ with an SCL
    backup for cloud shadows (which CloudScore+ does not flag reliably).

    CloudScore+ cs_cdf ranges from 0 (cloudy) to 1 (clear); we threshold at 0.65
    (Google's recommended default for NDVI time series).

    SCL backup flags these Scene Classification codes as cloudy:
        3  = cloud shadow
        8  = cloud medium probability
        9  = cloud high probability
        10 = thin cirrus

    Final mask = CloudScore+ cloud OR SCL cloud.

    Fallback: if no cs_cdf band is linked (e.g. no CloudScore+ match), falls
    back to SCL-only (and then QA60 if SCL is missing too).

    Refs:
      https://developers.google.com/earth-engine/datasets/catalog/GOOGLE_CLOUD_SCORE_PLUS_V1_S2_HARMONIZED
      https://sentinels.copernicus.eu/web/sentinel/technical-guides/sentinel-2-msi/level-2a/algorithm-overview
    """
    CS_THRESHOLD = 0.65
    SCL_CLOUD_CLASSES = [3, 8, 9, 10]  # shadow, cloud med, cloud high, cirrus

    has_cs = image.bandNames().contains("cs_cdf")
    has_scl = image.bandNames().contains("SCL")

    # CloudScore+ path: cs_cdf < threshold -> cloudy
    cs_cloud = image.select(["cs_cdf"]).lt(CS_THRESHOLD).rename("cloud")

    # SCL path: pixel classified as shadow/cloud/cirrus
    scl = image.select(["SCL"])
    scl_cloud = (
        scl.eq(SCL_CLOUD_CLASSES[0])
        .Or(scl.eq(SCL_CLOUD_CLASSES[1]))
        .Or(scl.eq(SCL_CLOUD_CLASSES[2]))
        .Or(scl.eq(SCL_CLOUD_CLASSES[3]))
        .rename("cloud")
    )

    # QA60 fallback path (only used if neither cs_cdf nor SCL are present)
    qa_cloud = (
        image.select(["QA60"])
        .bitwiseAnd(1 << 10)
        .Or(image.select(["QA60"]).bitwiseAnd(1 << 11))
        .neq(0)
        .rename("cloud")
    )

    # Preferred: CloudScore+ OR SCL. Degrade gracefully if bands are missing.
    cs_plus_scl = cs_cloud.Or(scl_cloud).rename("cloud")
    # Nested If: (has_cs ? (has_scl ? cs_plus_scl : cs_cloud) : (has_scl ? scl_cloud : qa_cloud))
    cloud_mask = ee.Image(
        ee.Algorithms.If(
            has_cs,
            ee.Algorithms.If(has_scl, cs_plus_scl, cs_cloud),
            ee.Algorithms.If(has_scl, scl_cloud, qa_cloud),
        )
    )
    return image.addBands(cloud_mask)


# Canonical registry of supported NDVI time series sources; constants.py
# derives SUPPORTED_TIMESERIES_SOURCES from this so the two never drift.
ds_configs = {
    "MODIS": {
        "collection_id": "MODIS/061/MOD09Q1",
        "NDVI": {
            "bands": {"nir": "sur_refl_b02", "red": "sur_refl_b01"},
            "scale": 250,
        },
        "cloudmask_callable": add_modis_cloud_mask,
        "link_cloudscore": False,
    },
    "SENTINEL2": {
        "collection_id": "COPERNICUS/S2_SR_HARMONIZED",
        "NDVI": {"bands": {"nir": "B8", "red": "B4"}, "scale": 10},
        "cloudmask_callable": add_s2_cloud_mask,
        "link_cloudscore": True,
    },
}


def _link_cloudscore_plus(s2_collection: ee.ImageCollection) -> ee.ImageCollection:
    """
    Link CloudScore+ cs_cdf band to each image in an S2 collection via inner join.

    This adds the cs_cdf band from GOOGLE/CLOUD_SCORE_PLUS/V1/S2_HARMONIZED
    to matching S2 images (matched by system:index).
    """
    cs_plus = ee.ImageCollection("GOOGLE/CLOUD_SCORE_PLUS/V1/S2_HARMONIZED")

    # Use a saveFirst join keyed on system:index
    join = ee.Join.saveFirst("cs_match")
    link_filter = ee.Filter.equals(leftField="system:index", rightField="system:index")

    joined = ee.ImageCollection(join.apply(s2_collection, cs_plus, link_filter))

    def _add_cs_band(image):
        cs_image = ee.Image(image.get("cs_match"))
        return image.addBands(cs_image.select(["cs_cdf"]))

    return joined.map(_add_cs_band)


def _region_data_to_dataframe(region_data: list) -> pd.DataFrame:
    """
    Shape a getRegion() result (header row + [lon, lat, time, NDVI, cloud] rows)
    into the [time, values, cloud] dataframe the API returns.
    """
    columns = region_data[0]
    records = region_data[1:]

    df = pd.DataFrame(records, columns=columns)
    df["time"] = pd.to_datetime(df["time"], unit="ms")
    df.rename(columns={"NDVI": "values"}, inplace=True)

    # Clip NDVI to valid range [0, 1]
    df["values"] = df["values"].clip(lower=0, upper=1)

    # Ensure cloudy values are integers
    df["cloud"] = df["cloud"].fillna(0).astype(int)

    return df[["time", "values", "cloud"]]


def fetch_ndvi(
    source: str,
    latitude: float,
    longitude: float,
    start_date: str,
    end_date: str,
) -> pd.DataFrame:
    """
    Fetch NDVI time series for a specific point from Earth Engine, given a date
    range and source.
    """
    config = ds_configs.get(source.upper())
    if not config:
        raise ValueError(
            f"Source '{source}' not recognized. Available sources: {list(ds_configs.keys())}"
        )

    if "NDVI" not in config:
        raise ValueError(f"NDVI not yet supported for data source: {source}")

    # Create EE point for querying
    point = ee.Geometry.Point([longitude, latitude])

    # Build image collection with NDVI band
    collection = (
        ee.ImageCollection(config["collection_id"])
        .filterDate(start_date, end_date)
        .filterBounds(point)
    )

    # Link CloudScore+ for Sentinel-2 (adds cs_cdf band to each image)
    if config.get("link_cloudscore"):
        collection = _link_cloudscore_plus(collection)

    collection = collection.map(
        lambda img: add_ndvi_band_to_ee_image(img, **config["NDVI"]["bands"])
    ).map(config["cloudmask_callable"])

    # Extract NDVI & cloud values at the point over time. The EE client retries
    # 429s with backoff internally; if it still fails we surface a domain error
    # instead of letting the raw stack trace propagate.
    try:
        region_data = (
            collection.select(["NDVI", "cloud"]).getRegion(point, config["NDVI"]["scale"]).getInfo()
        )
    except (ee.EEException, HttpError) as exc:
        status = getattr(getattr(exc, "resp", None), "status", None)
        message = str(exc)
        if status == 429 or "429" in message or "quota" in message.lower():
            raise RateLimited(message) from exc
        raise UpstreamFailed(message) from exc

    return _region_data_to_dataframe(region_data)
