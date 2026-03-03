"""
Development database seeding script.
Creates a sample Ukraine campaign with Sentinel-2 imagery (all 12 months, weekly slices)
and 100 random sample points within Ukraine's bounding box.

Usage:
    python seed_dev_data.py              # Seed the database
    python seed_dev_data.py clear        # Clear seed data
    python seed_dev_data.py FIREBASE_UID # Seed with specific Firebase UID for initial user
"""

import json
import logging
import sys

from shapely.geometry import box as shapely_box
from sqlalchemy import insert, select

from src.annotation.models import AnnotationGeometry, AnnotationTask, AnnotationTaskAssignment
from src.auth.constants import ROLE_ADMIN, ROLE_APPROVED
from src.auth.models import User, UserRole
from src.campaigns.models import Campaign
from src.campaigns.schemas import CampaignSettingsCreate, LabelBase
from src.campaigns.service import create_campaign
from src.database import SessionLocal
from src.imagery.schemas import ImageryCreate, ImageryVisualizationUrlTemplateCreate
from src.sampling_design.service import generate_random_points
from src.timeseries.models import TimeSeries  # noqa: F401 - keeps SQLAlchemy mapper happy

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Ukraine bounding box (WGS-84)
# ---------------------------------------------------------------------------
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


def _ensure_user(db, firebase_uid: str) -> User:
    """Return existing user or create a new one with admin + approved roles."""
    user = db.execute(
        select(User).where(User.issuer == "firebase").where(User.external_uid == firebase_uid)
    ).scalar_one_or_none()

    if not user:
        logger.info("Creating user with Firebase UID: %s", firebase_uid)
        user = User(
            issuer="firebase",
            external_uid=firebase_uid,
            email=f"dev-{firebase_uid}@test.com",
            display_name="Dev Test User",
        )
        db.add(user)
        db.flush()
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


def seed_dev_data(firebase_uid: str = None):
    """Seed development data into the database.

    Args:
        firebase_uid: Optional Firebase UID. If not provided, uses a test UID.
    """
    db = SessionLocal()
    try:
        logger.info("Starting database seeding...")

        # Drop existing dev campaign so the script is idempotent
        existing = db.execute(
            select(Campaign).where(Campaign.name == CAMPAIGN_NAME)
        ).scalar_one_or_none()
        if existing:
            logger.info("Campaign already exists - deleting and recreating...")
            db.delete(existing)
            db.commit()

        if firebase_uid is None:
            firebase_uid = "dev-test-uid"
            logger.info("No Firebase UID provided, using test UID: %s", firebase_uid)

        user = _ensure_user(db, firebase_uid)

        # ------------------------------------------------------------------
        # One Sentinel-2 imagery spanning all of 2024.
        # Monthly windows (window_interval=1 month) with weekly slices inside
        # each window (slicing_interval=1 week) -> 12 windows × ~4 slices each.
        # ------------------------------------------------------------------
        imagery_configs = [
            ImageryCreate(
                name="Sentinel-2 Ukraine 2024",
                start_ym="202401",
                end_ym="202412",
                crosshair_hex6="FF0000",
                default_zoom=14,
                window_interval=1,
                window_unit="months",
                slicing_interval=1,
                slicing_unit="weeks",
                registration_url=(
                    "https://planetarycomputer.microsoft.com/api/data/v1/mosaic/register"
                ),
                search_body=SENTINEL2_SEARCH_BODY,
                visualization_url_templates=[
                    ImageryVisualizationUrlTemplateCreate(
                        name="True Color",
                        visualization_url=(
                            "https://planetarycomputer.microsoft.com/api/data/v1/mosaic"
                            "/{searchId}/tiles/WebMercatorQuad/{z}/{x}/{y}"
                            "?assets=B04&assets=B03&assets=B02&nodata=0"
                            "&color_formula=Gamma+RGB+3.2+Saturation+0.8+Sigmoidal+RGB+25+0.35"
                            "&collection=sentinel-2-l2a&pixel_selection=median"
                        ),
                    ),
                    ImageryVisualizationUrlTemplateCreate(
                        name="False Color Infrared",
                        visualization_url=(
                            "https://planetarycomputer.microsoft.com/api/data/v1/mosaic"
                            "/{searchId}/tiles/WebMercatorQuad/{z}/{x}/{y}"
                            "?assets=B08&assets=B04&assets=B03&nodata=0"
                            "&color_formula=Gamma+RGB+3.7+Saturation+1.5+Sigmoidal+RGB+15+0.35"
                            "&collection=sentinel-2-l2a&pixel_selection=median"
                        ),
                    ),
                ],
            )
        ]

        # ------------------------------------------------------------------
        # Campaign settings
        # ------------------------------------------------------------------
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

        # ------------------------------------------------------------------
        # Create campaign (handles layout, windows, imagery all at once)
        # ------------------------------------------------------------------
        logger.info("Creating campaign via service...")
        campaign = create_campaign(
            db,
            name=CAMPAIGN_NAME,
            mode="tasks",
            settings=settings,
            user_id=user.id,
            imagery_configs=imagery_configs,
        )
        logger.info("Campaign created: id=%d", campaign.id)

        # ------------------------------------------------------------------
        # Generate 100 random points within Ukraine bbox and create tasks
        # ------------------------------------------------------------------
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

        logger.info("\nDatabase seeding complete!")
        logger.info("  Campaign ID   : %d", campaign.id)
        logger.info("  Campaign Name : %s", campaign.name)
        logger.info("  User          : %s", user.email)
        logger.info("  Firebase UID  : %s", user.external_uid)
        logger.info("  Imagery items : 1 (Jan-Dec 2024, monthly windows, weekly slices)")
        logger.info("  Tasks created : %d", len(task_ids))
        logger.info("  Labels        : %d", len(settings.labels))

    finally:
        db.close()


def clear_dev_data():
    """Clear development data from the database."""
    db = SessionLocal()
    try:
        logger.info("Clearing development data...")

        campaign = db.execute(
            select(Campaign).where(Campaign.name == CAMPAIGN_NAME)
        ).scalar_one_or_none()

        if campaign:
            db.delete(campaign)
            db.commit()
            logger.info("Development campaign deleted.")
        else:
            logger.info("No development campaign found.")

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
