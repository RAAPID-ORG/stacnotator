"""
Development database seeding script.
Creates two sample Ukraine campaigns with Sentinel-2 imagery (all 12 months, weekly slices)
and S2 NDVI timeseries:
  1. Task-mode campaign with 100 random sample points within Ukraine's bounding box
  2. Open-mode campaign (same region and imagery, no tasks)

Usage:
    python seed_dev_data.py              # Seed (local auth: auto-creates local user,
                                         #        firebase auth: uses test UID)
    python seed_dev_data.py clear        # Clear seed data
    python seed_dev_data.py FIREBASE_UID # Seed with specific Firebase UID for initial user
"""

import json
import logging
import sys

from shapely.geometry import box as shapely_box
from sqlalchemy import insert, select

from src.annotation.models import AnnotationGeometry, AnnotationTask, AnnotationTaskAssignment
from src.auth.constants import ROLE_ADMIN, ROLE_APPROVED, ROLE_USER
from src.auth.models import User, UserRole
from src.campaigns.models import Campaign
from src.campaigns.schemas import CampaignSettingsCreate, LabelBase
from src.campaigns.service import create_campaign
from src.config import get_settings
from src.database import SessionLocal
from src.imagery.schemas import (
    CollectionStacConfigCreate,
    ImageryCollectionCreate,
    ImageryEditorStateCreate,
    ImagerySliceCreate,
    ImagerySourceCreate,
    ImageryViewCreate,
    SliceTileUrlCreate,
    ViewCollectionRefCreate,
    VisualizationTemplateCreate,
)
from src.sampling_design.service import generate_random_points
from src.timeseries.models import TimeSeries  # noqa: F401 - keeps SQLAlchemy mapper happy
from src.timeseries.schemas import TimeSeriesCreate

logger = logging.getLogger(__name__)

# Ukraine bounding box (WGS-84)
UKRAINE_BBOX = dict(bbox_west=22.1, bbox_south=44.3, bbox_east=40.2, bbox_north=52.4)

# Sentinel-2 Planetary Computer search body template (placeholders filled at query time)
SENTINEL2_SEARCH_BODY = json.dumps(
    {
        "bbox": "{campaignBBoxPlaceholder}",
        "filter": {
            "op": "and",
            "args": [
                {
                    "op": "anyinteracts",
                    "args": [
                        {"property": "datetime"},
                        {"interval": ["{startDatetimePlaceholder}", "{endDatetimePlaceholder}"]},
                    ],
                },
                {"op": "<=", "args": [{"property": "eo:cloud_cover"}, 70]},
                {"op": "=", "args": [{"property": "collection"}, "sentinel-2-l2a"]},
            ],
        },
        "metadata": {
            "type": "mosaic",
            "maxzoom": 24,
            "minzoom": 0,
            "pixel_selection": "median",
        },
        "filterLang": "cql2-json",
        "collections": ["sentinel-2-l2a"],
    }
)

CAMPAIGN_NAME = "Ukraine Dev Campaign"
OPEN_CAMPAIGN_NAME = "Ukraine Open-Mode Dev Campaign"


def _ensure_user(db, firebase_uid: str | None = None) -> User:
    """Return existing user or create a new one with admin + approved roles.

    In local auth mode, creates the fixed local user (issuer="local",
    external_uid="local-user") so that it matches the LocalAuthProvider.
    """
    settings = get_settings()
    is_local = settings.AUTH_PROVIDER == "local"

    if is_local:
        issuer = "local"
        external_uid = "local-user"
        email = "local@localhost"
        display_name = "Local Admin"
    else:
        issuer = "firebase"
        external_uid = firebase_uid or "dev-test-uid"
        email = f"dev-{external_uid}@test.com"
        display_name = "Dev Test User"

    user = db.execute(
        select(User).where(User.issuer == issuer).where(User.external_uid == external_uid)
    ).scalar_one_or_none()

    if not user:
        logger.info("Creating user (%s/%s)", issuer, external_uid)
        user = User(
            issuer=issuer,
            external_uid=external_uid,
            email=email,
            display_name=display_name,
        )
        db.add(user)
        db.flush()
        db.add(UserRole(user_id=user.id, role=ROLE_USER))
        db.add(UserRole(user_id=user.id, role=ROLE_APPROVED))
        db.add(UserRole(user_id=user.id, role=ROLE_ADMIN))
        db.flush()
    else:
        logger.info("Using existing user: %s", user.email)
        if not user.is_approved:
            db.add(UserRole(user_id=user.id, role=ROLE_APPROVED))
        if not user.is_admin:
            db.add(UserRole(user_id=user.id, role=ROLE_ADMIN))
        db.flush()

    return user


def seed_dev_data(firebase_uid: str | None = None):
    """Seed development data into the database.

    Args:
        firebase_uid: Optional Firebase UID. Ignored in local auth mode.
                      If not provided in firebase mode, uses a test UID.
    """
    db = SessionLocal()
    try:
        logger.info("Starting database seeding...")

        # Drop existing dev campaigns so the script is idempotent
        for name in (CAMPAIGN_NAME, OPEN_CAMPAIGN_NAME):
            existing = db.execute(
                select(Campaign).where(Campaign.name == name)
            ).scalar_one_or_none()
            if existing:
                logger.info("Campaign '%s' already exists - deleting and recreating...", name)
                db.delete(existing)
        db.commit()

        user = _ensure_user(db, firebase_uid)

        # One Sentinel-2 imagery source spanning all of 2024.
        # One collection with 12 monthly slices, each with two visualization URL templates.
        true_color_url = (
            "https://planetarycomputer.microsoft.com/api/data/v1/mosaic"
            "/{searchId}/tiles/WebMercatorQuad/{z}/{x}/{y}"
            "?assets=B04&assets=B03&assets=B02&nodata=0"
            "&color_formula=Gamma+RGB+3.2+Saturation+0.8+Sigmoidal+RGB+25+0.35"
            "&collection=sentinel-2-l2a&pixel_selection=median"
        )
        false_color_url = (
            "https://planetarycomputer.microsoft.com/api/data/v1/mosaic"
            "/{searchId}/tiles/WebMercatorQuad/{z}/{x}/{y}"
            "?assets=B08&assets=B04&assets=B03&nodata=0"
            "&color_formula=Gamma+RGB+3.7+Saturation+1.5+Sigmoidal+RGB+15+0.35"
            "&collection=sentinel-2-l2a&pixel_selection=median"
        )

        monthly_slices = []
        for month in range(1, 13):
            end_month = month + 1 if month < 12 else 12
            end_year = 2024 if month < 12 else 2024
            monthly_slices.append(
                ImagerySliceCreate(
                    name=f"2024-{month:02d}",
                    start_date=f"2024-{month:02d}-01",
                    end_date=f"{end_year}-{end_month:02d}-{'28' if month == 12 else '01'}",
                    tile_urls=[
                        SliceTileUrlCreate(
                            visualization_name="True Color", tile_url=true_color_url
                        ),
                        SliceTileUrlCreate(
                            visualization_name="False Color Infrared", tile_url=false_color_url
                        ),
                    ],
                )
            )

        imagery_editor_state = ImageryEditorStateCreate(
            sources=[
                ImagerySourceCreate(
                    name="Sentinel-2 Ukraine 2024",
                    crosshair_hex6="FF0000",
                    default_zoom=14,
                    visualizations=[
                        VisualizationTemplateCreate(name="True Color"),
                        VisualizationTemplateCreate(name="False Color Infrared"),
                    ],
                    collections=[
                        ImageryCollectionCreate(
                            name="2024 Monthly Mosaics",
                            cover_slice_index=5,
                            stac_config=CollectionStacConfigCreate(
                                registration_url="https://planetarycomputer.microsoft.com/api/data/v1/mosaic/register",
                                search_body=SENTINEL2_SEARCH_BODY,
                            ),
                            slices=monthly_slices,
                        ),
                    ],
                ),
            ],
            views=[
                ImageryViewCreate(
                    name="Default View",
                    collection_refs=[
                        ViewCollectionRefCreate(
                            source_id="0", collection_id="0", show_as_window=True
                        ),
                    ],
                ),
            ],
            basemaps=[],
        )

        # S2 NDVI timeseries (from Google Earth Engine)
        timeseries_configs = [
            TimeSeriesCreate(
                name="S2 NDVI",
                start_ym="202401",
                end_ym="202412",
                data_source="SENTINEL2",
                provider="EE",
                ts_type="NDVI",
            ),
        ]

        # Campaign settings
        settings = CampaignSettingsCreate(
            labels=[
                LabelBase(id=1, name="Building"),
                LabelBase(id=2, name="Road"),
                LabelBase(id=3, name="Tree"),
                LabelBase(id=4, name="Water"),
                LabelBase(id=5, name="Crop Field"),
            ],
            **UKRAINE_BBOX,
        )

        # Create campaign (handles layout, imagery, timeseries all at once)
        logger.info("Creating task-mode campaign via service...")
        campaign = create_campaign(
            db,
            name=CAMPAIGN_NAME,
            mode="tasks",
            settings=settings,
            user_id=user.id,
            imagery_editor_state=imagery_editor_state,
            timeseries_configs=timeseries_configs,
        )
        logger.info("Campaign created: id=%d", campaign.id)

        # Generate 100 random points within Ukraine bbox and create tasks
        logger.info("Generating 100 random sample points within Ukraine bounding box...")
        ukraine_polygon = shapely_box(
            UKRAINE_BBOX["bbox_west"],
            UKRAINE_BBOX["bbox_south"],
            UKRAINE_BBOX["bbox_east"],
            UKRAINE_BBOX["bbox_north"],
        )
        sample_points = generate_random_points(ukraine_polygon, num_samples=100, seed=42)

        logger.info("Creating %d annotation tasks...", len(sample_points))
        geometry_records = [{"geometry": f"SRID=4326;POINT({pt.x} {pt.y})"} for pt in sample_points]
        geometry_result = db.execute(
            insert(AnnotationGeometry).returning(AnnotationGeometry.id),
            geometry_records,
        )
        geometry_ids = [row.id for row in geometry_result]

        task_records = [
            {
                "annotation_number": i + 1,
                "campaign_id": campaign.id,
                "geometry_id": geom_id,
                "status": "pending",
                "raw_source_data": {
                    "sampling_strategy": "random",
                    "lon": pt.x,
                    "lat": pt.y,
                },
            }
            for i, (geom_id, pt) in enumerate(zip(geometry_ids, sample_points, strict=True))
        ]
        task_result = db.execute(
            insert(AnnotationTask).returning(AnnotationTask.id),
            task_records,
        )
        task_ids = [row.id for row in task_result]

        # Assign all tasks to the seeded user
        db.execute(
            insert(AnnotationTaskAssignment),
            [{"task_id": tid, "user_id": user.id} for tid in task_ids],
        )

        db.commit()

        # Open-mode campaign (same imagery & timeseries, no tasks)
        logger.info("Creating open-mode campaign via service...")
        open_campaign = create_campaign(
            db,
            name=OPEN_CAMPAIGN_NAME,
            mode="open",
            settings=settings,
            user_id=user.id,
            imagery_editor_state=imagery_editor_state,
            timeseries_configs=timeseries_configs,
        )
        logger.info("Open-mode campaign created: id=%d", open_campaign.id)

        logger.info("\nDatabase seeding complete!")
        logger.info("  Task-mode Campaign  : id=%d  name=%s", campaign.id, campaign.name)
        logger.info("  Open-mode Campaign  : id=%d  name=%s", open_campaign.id, open_campaign.name)
        logger.info("  User                : %s", user.email)
        logger.info("  Firebase UID        : %s", user.external_uid)
        logger.info("  Imagery items       : 1 source, 1 collection, 12 monthly slices")
        logger.info("  Timeseries          : S2 NDVI (2024)")
        logger.info("  Tasks (task-mode)   : %d", len(task_ids))
        logger.info("  Labels              : %d", len(settings.labels))

    finally:
        db.close()


def clear_dev_data():
    """Clear development data from the database."""
    db = SessionLocal()
    try:
        logger.info("Clearing development data...")

        for name in (CAMPAIGN_NAME, OPEN_CAMPAIGN_NAME):
            campaign = db.execute(
                select(Campaign).where(Campaign.name == name)
            ).scalar_one_or_none()

            if campaign:
                db.delete(campaign)
                logger.info("Deleted campaign: %s", name)
            else:
                logger.info("No campaign found: %s", name)

        db.commit()
        logger.info("Development data cleared.")

    finally:
        db.close()


def main():
    """Main entry point."""

    if len(sys.argv) > 1 and sys.argv[1] == "clear":
        clear_dev_data()
    elif len(sys.argv) > 1:
        # Use provided Firebase UID
        firebase_uid = sys.argv[1]
        seed_dev_data(firebase_uid)
    else:
        # Use default test UID
        seed_dev_data()


if __name__ == "__main__":
    main()
