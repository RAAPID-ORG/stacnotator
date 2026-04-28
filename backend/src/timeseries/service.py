from typing import Literal

import ee
import pandas as pd
from fastapi import HTTPException
from googleapiclient.errors import HttpError
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from src.campaigns.models import Campaign, CanvasLayout
from src.config import get_settings
from src.timeseries.models import TimeSeries
from src.timeseries.schemas import TimeSeriesCreate, TimeSeriesOut
from src.utils import find_free_position_in_layout

settings = get_settings()


# ============================================================================
# Currently only Earth Engine is supported as a timeseries data source.
# STAC catalog support is not yet implemented due to performance constraints.


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


# Configuration for supported NDVI time series sources
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


def fetch_ndvi_timeseries_ee(
    source: str,
    latitude: float,
    longitude: float,
    start_date: str,
    end_date: str,
) -> pd.DataFrame:
    """
    Fetch NDVI timeseries for specific point from earth engine, date range and source
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
    # 429s with backoff internally; if it still fails we surface a clean error
    # instead of letting the raw stack trace become a 500.
    try:
        region_data = (
            collection.select(["NDVI", "cloud"]).getRegion(point, config["NDVI"]["scale"]).getInfo()
        )
    except (ee.EEException, HttpError) as exc:
        status = getattr(getattr(exc, "resp", None), "status", None)
        message = str(exc)
        if status == 429 or "429" in message or "quota" in message.lower():
            raise HTTPException(
                status_code=503,
                detail="Earth Engine is rate-limiting requests. Please retry in a moment.",
            ) from exc
        raise HTTPException(
            status_code=502,
            detail=f"Earth Engine request failed: {message}",
        ) from exc

    # First row: column headers, subsequent rows: [longitude, latitude, time, NDVI]
    columns = region_data[0]
    records = region_data[1:]

    # Build DataFrame
    df = pd.DataFrame(records, columns=columns)
    df["time"] = pd.to_datetime(df["time"], unit="ms")
    df.rename(columns={"NDVI": "values"}, inplace=True)

    # Clip NDVI to valid range [0, 1]
    df["values"] = df["values"].clip(lower=0, upper=1)

    # Ensure cloudy values are integers
    df["cloud"] = df["cloud"].fillna(0).astype(int)

    # Return only relevant columns
    return df[["time", "values", "cloud"]]


def get_timeseries_data(
    ts_type: str,
    source: Literal["MODIS", "SENTINEL2"],
    latitude: float,
    longitude: float,
    start_date: str,
    end_date: str,
) -> pd.DataFrame:
    if ts_type == "NDVI":
        return fetch_ndvi_timeseries_ee(
            source, latitude=latitude, longitude=longitude, start_date=start_date, end_date=end_date
        )
    else:
        raise ValueError("Currenty only supporting NDVI timeseries.")


# ============================================================================
# Timeseries management functions
# ============================================================================


def _add_timeseries_entry_to_layout(
    layout_data: list[dict],
    window_width: int = 10,
    window_height: int = 12,
    grid_width: int = 60,
) -> bool:
    """
    Add a single "timeseries" entry to canvas layout if it doesn't already exist.

    There is always only one timeseries entry with id "timeseries" regardless of
    how many actual timeseries exist in the campaign.

    Args:
        layout_data: Existing layout data to append to (modified in place)
        window_width: Width of timeseries window in grid units
        window_height: Height of timeseries window in grid units
        grid_width: Total grid width available

    Returns:
        True if timeseries entry was added, False if it already existed
    """
    # Check if timeseries entry already exists in the layout
    timeseries_key = "timeseries"
    if any(item.get("i") == timeseries_key for item in layout_data):
        return False

    # Find free position and add to layout
    x, y = find_free_position_in_layout(
        layout_data=layout_data,
        item_width=window_width,
        item_height=window_height,
        grid_width=grid_width,
    )

    layout_entry = {
        "i": timeseries_key,
        "x": x,
        "y": y,
        "w": window_width,
        "h": window_height,
    }
    layout_data.append(layout_entry)

    return True


def get_timeseries_for_campaign(campaign_id: int, db: Session) -> list[TimeSeriesOut]:
    # Check campaign exists
    campaign = db.execute(select(Campaign).where(Campaign.id == campaign_id)).scalar_one_or_none()
    if not campaign:
        raise HTTPException(status_code=404, detail=f"Campaign with id {campaign_id} not found")

    ts_items = (
        db.execute(select(TimeSeries).where(TimeSeries.campaign_id == campaign_id)).scalars().all()
    )
    return ts_items


def create_timeseries_bulk(
    campaign_id: int, ts_creates: list[TimeSeriesCreate], db: Session
) -> list[TimeSeriesOut]:
    """
    Create multiple timeseries for a campaign and add timeseries entry to canvas layouts.

    This function:
    1. Creates the timeseries database entries
    2. Adds a single "timeseries" entry to all main canvas layouts if this is the first timeseries

    Args:
        campaign_id: ID of the campaign
        ts_creates: List of timeseries creation schemas
        db: Database session

    Returns:
        List of created timeseries objects
    """
    # Verify campaign exists
    campaign = db.execute(select(Campaign).where(Campaign.id == campaign_id)).scalar_one_or_none()
    if not campaign:
        raise HTTPException(status_code=404, detail=f"Campaign with id {campaign_id} not found")

    # Check if campaign already has timeseries
    existing_count = db.execute(
        select(func.count()).select_from(TimeSeries).where(TimeSeries.campaign_id == campaign_id)
    ).scalar_one()

    # Create timeseries entries
    new_items = []
    for ts_create in ts_creates:
        ts_item = TimeSeries(
            campaign_id=campaign_id,
            name=ts_create.name,
            start_ym=ts_create.start_ym,
            end_ym=ts_create.end_ym,
            data_source=ts_create.data_source,
            provider=ts_create.provider,
            ts_type=ts_create.ts_type,
        )
        new_items.append(ts_item)

    db.add_all(new_items)
    db.flush()

    # If this is the first timeseries for the campaign, add timeseries entry to all main layouts
    if existing_count == 0:
        # Get all main canvas layouts for this campaign (default and personal)
        # Main layouts have view_id = None
        main_layouts = (
            db.execute(
                select(CanvasLayout).where(
                    CanvasLayout.campaign_id == campaign_id,
                    CanvasLayout.view_id.is_(None),
                )
            )
            .scalars()
            .all()
        )

        # Add single timeseries entry to all layouts
        for layout in main_layouts:
            added = _add_timeseries_entry_to_layout(
                layout_data=layout.layout_data,
                window_width=10,
                window_height=4,
            )
            if added:
                # Mark layout_data as modified so SQLAlchemy knows to update it
                flag_modified(layout, "layout_data")

    db.commit()
    return new_items


def get_timeseries_by_id(timeseries_id: int, db: Session) -> TimeSeries:
    ts_item = db.execute(
        select(TimeSeries).where(TimeSeries.id == timeseries_id)
    ).scalar_one_or_none()
    if not ts_item:
        raise HTTPException(status_code=404, detail=f"TimeSeries with id {timeseries_id} not found")
    return ts_item


def delete_timeseries(timeseries_id: int, campaign_id: int, db: Session) -> None:
    """
    Delete a timeseries and update canvas layouts.

    If this is the last timeseries in the campaign, removes the "timeseries"
    entry from all main canvas layouts (default and personal).

    Args:
        timeseries_id: ID of the timeseries to delete
        campaign_id: ID of the campaign (for validation)
        db: Database session
    """
    # Verify timeseries exists and belongs to campaign
    ts_item = db.execute(
        select(TimeSeries).where(
            TimeSeries.id == timeseries_id,
            TimeSeries.campaign_id == campaign_id,
        )
    ).scalar_one_or_none()

    if not ts_item:
        raise HTTPException(
            status_code=404,
            detail=f"TimeSeries {timeseries_id} not found in campaign {campaign_id}",
        )

    # Check if this is the last timeseries in the campaign
    remaining_count = db.execute(
        select(func.count())
        .select_from(TimeSeries)
        .where(
            TimeSeries.campaign_id == campaign_id,
            TimeSeries.id != timeseries_id,
        )
    ).scalar_one()

    # Delete the timeseries
    db.delete(ts_item)
    db.flush()

    # If this was the last timeseries, remove the timeseries entry from all layouts
    if remaining_count == 0:
        timeseries_key = "timeseries"

        # Get all main canvas layouts for this campaign
        main_layouts = (
            db.execute(
                select(CanvasLayout).where(
                    CanvasLayout.campaign_id == campaign_id,
                    CanvasLayout.view_id.is_(None),
                )
            )
            .scalars()
            .all()
        )

        # Remove timeseries entry from each layout
        for layout in main_layouts:
            # Filter out the timeseries entry
            layout.layout_data = [
                item for item in layout.layout_data if item.get("i") != timeseries_key
            ]
            flag_modified(layout, "layout_data")

    db.commit()
