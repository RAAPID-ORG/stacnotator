"""
Development database seeding script.
Creates two sample Ukraine campaigns with Sentinel-2 imagery (12 monthly slices)
and optional S2 NDVI timeseries when Earth Engine is configured:
  1. Task-mode campaign with 100 random sample points within Ukraine's bounding box
  2. Open-mode campaign (same region and imagery, no tasks)

Usage:
    python seed_dev_data.py              # Seed (local auth: auto-creates local user,
                                         #        firebase auth: uses test UID)
    python seed_dev_data.py clear        # Clear seed data
    python seed_dev_data.py FIREBASE_UID # Seed with specific Firebase UID for initial user
"""

import logging
import sys
import time
from calendar import monthrange

from shapely.geometry import box as shapely_box
from sqlalchemy import insert, select
from sqlalchemy.orm import Session

import src.models  # noqa: F401 -- side-effect import: ensures all ORM models are registered before any mapper configures  # isort: skip

from src.annotation.models import AnnotationTask, AnnotationTaskAssignment
from src.auth.constants import ROLE_ADMIN, ROLE_USER
from src.auth.models import User, UserRole
from src.campaigns.models import Campaign, TaskSet
from src.campaigns.schemas import CampaignSettingsCreate, LabelBase
from src.campaigns.service import create_campaign
from src.campaigns.task_sets import DEFAULT_TASK_SET_NAME
from src.config import get_settings
from src.database import SessionLocal
from src.earth_engine import ensure_earth_engine
from src.imagery.schemas import (
    CollectionStacConfigCreate,
    ImageryCollectionCreate,
    ImageryEditorStateCreate,
    ImagerySliceCreate,
    ImagerySourceCreate,
    ImageryViewCreate,
    NamedVizParamsCreate,
    VisualizationTemplateCreate,
    VizParamsCreate,
)
from src.imagery.service import create_view
from src.organizations.models import (
    MEMBER_STATUS_ACTIVE,
    ORG_STATUS_APPROVED,
    Organization,
    OrganizationTiler,
    OrganizationUser,
)
from src.projects.models import Project, ProjectUser
from src.sampling_design.schemas import RandomSamplingConfig
from src.sampling_design.service import create_tasks_from_sampling_strategy
from src.tilers import registry
from src.timeseries.schemas import TimeSeriesCreate

logger = logging.getLogger(__name__)

# Ukraine bounding box (WGS-84)
UKRAINE_BBOX = dict(bbox_west=22.1, bbox_south=44.3, bbox_east=40.2, bbox_north=52.4)

MPC_CATALOG_URL = "https://planetarycomputer.microsoft.com/api/stac/v1"

CAMPAIGN_NAME = "Ukraine Dev Campaign"
OPEN_CAMPAIGN_NAME = "Ukraine Open-Mode Dev Campaign"


def _monthly_slices(year: int) -> list[ImagerySliceCreate]:
    return [
        ImagerySliceCreate(
            name=f"{year}-{month:02d}",
            start_date=f"{year}-{month:02d}-01",
            end_date=f"{year}-{month:02d}-{monthrange(year, month)[1]:02d}",
        )
        for month in range(1, 13)
    ]


def _stac_search_query() -> dict:
    return {
        "collections": ["sentinel-2-l2a"],
        "filter": {
            "op": "and",
            "args": [
                {
                    "op": "anyinteracts",
                    "args": [
                        {"property": "datetime"},
                        {"interval": ["{sliceStart}", "{sliceEnd}"]},
                    ],
                },
                {
                    "op": "or",
                    "args": [
                        {"op": "isNull", "args": [{"property": "eo:cloud_cover"}]},
                        {"op": "<=", "args": [{"property": "eo:cloud_cover"}, 70]},
                    ],
                },
            ],
        },
        "filterLang": "cql2-json",
        "sortby": [{"field": "datetime", "direction": "desc"}],
    }


def _seed_tasks(db: Session, campaign: Campaign, user: User) -> list[int]:
    task_set_id = db.execute(
        select(TaskSet.id).where(
            TaskSet.campaign_id == campaign.id, TaskSet.name == DEFAULT_TASK_SET_NAME
        )
    ).scalar_one()
    region = shapely_box(
        UKRAINE_BBOX["bbox_west"],
        UKRAINE_BBOX["bbox_south"],
        UKRAINE_BBOX["bbox_east"],
        UKRAINE_BBOX["bbox_north"],
    )
    create_tasks_from_sampling_strategy(
        db,
        campaign.id,
        RandomSamplingConfig(num_samples=100, seed=42),
        region,
        task_set_id,
    )
    task_ids = list(
        db.scalars(
            select(AnnotationTask.id)
            .where(AnnotationTask.campaign_id == campaign.id)
            .order_by(AnnotationTask.annotation_number)
        )
    )
    db.execute(
        insert(AnnotationTaskAssignment),
        [{"task_id": tid, "user_id": user.id} for tid in task_ids],
    )
    db.commit()
    return task_ids


def _wait_for_registration(db: Session, campaign_id: int, timeout: float = 180) -> None:
    deadline = time.monotonic() + timeout
    while True:
        db.expire_all()
        campaign = db.get(Campaign, campaign_id)
        if campaign is None:
            raise RuntimeError(f"Seeded campaign {campaign_id} no longer exists")
        status = campaign.registration_status
        errors = campaign.registration_errors
        db.rollback()
        if status == "ready":
            return
        if status != "registering":
            raise RuntimeError(f"Imagery registration failed for campaign {campaign_id}: {errors}")
        if time.monotonic() >= deadline:
            raise TimeoutError(f"Imagery registration timed out for campaign {campaign_id}")
        time.sleep(1)


def _ensure_user(db: Session, firebase_uid: str | None = None) -> User:
    """Return existing user or create a new one with the user + admin roles.

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
        db.add(UserRole(user_id=user.id, role=ROLE_ADMIN))
        db.flush()
    else:
        logger.info("Using existing user: %s", user.email)
        if not user.is_admin:
            db.add(UserRole(user_id=user.id, role=ROLE_ADMIN))
        db.flush()

    return user


def _ensure_dev_org_and_project(db: Session, user: User) -> Project:
    """Create or retrieve the Dev Org and its project.

    Returns the Project so campaigns can be created under it.
    """
    org = db.scalar(select(Organization).where(Organization.name == "Dev Org"))
    if org is None:
        org = Organization(
            name="Dev Org",
            description="Local development organization",
            status=ORG_STATUS_APPROVED,
            allows_internal_storage=True,
            created_by=user.id,
        )
        db.add(org)
        db.flush()
        db.add(
            OrganizationUser(
                user_id=user.id,
                organization_id=org.id,
                is_admin=True,
                status=MEMBER_STATUS_ACTIVE,
            )
        )
        for tiler_name in registry.all_names():
            db.add(OrganizationTiler(organization_id=org.id, tiler_name=tiler_name))
    project = db.scalar(
        select(Project).where(Project.organization_id == org.id, Project.name == "Ukraine Crops")
    )
    if project is None:
        project = Project(
            organization_id=org.id,
            name="Ukraine Crops",
            description="Seeded sample project",
            created_by=user.id,
        )
        db.add(project)
        db.flush()
        db.add(
            ProjectUser(
                user_id=user.id,
                project_id=project.id,
                is_admin=True,
                is_authoritative_reviewer=True,
            )
        )
    db.commit()
    return project


def _seed_default_view(db, campaign_id: int) -> None:
    """Give a seeded campaign one view spanning every source, so annotation
    works without first authoring a view in edit mode."""
    campaign = db.get(Campaign, campaign_id)
    create_view(
        db,
        campaign,
        ImageryViewCreate(
            name="Default View",
            source_ids=[source.id for source in campaign.imagery_sources],
        ),
    )


def seed_dev_data(firebase_uid: str | None = None):
    """Seed development data into the database.

    Args:
        firebase_uid: Optional Firebase UID. Ignored in local auth mode.
                      If not provided in firebase mode, uses a test UID.
    """
    db = SessionLocal()
    try:
        logger.info("Starting database seeding...")

        user = _ensure_user(db, firebase_uid)
        project = _ensure_dev_org_and_project(db, user)

        # Only replace the demo campaigns in the seeded project.
        for name in (CAMPAIGN_NAME, OPEN_CAMPAIGN_NAME):
            existing = db.execute(
                select(Campaign).where(Campaign.name == name, Campaign.project_id == project.id)
            ).scalar_one_or_none()
            if existing:
                logger.info("Campaign '%s' already exists - deleting and recreating...", name)
                db.delete(existing)
        db.commit()

        # One Sentinel-2 imagery source spanning all of 2024: one MPC stac-browser
        # collection with 12 monthly slices and two named visualizations. Tile URLs
        # are built by the background mosaic registration, not seeded.
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
                                catalog_url=MPC_CATALOG_URL,
                                stac_collection_id="sentinel-2-l2a",
                                max_cloud_cover=70,
                                search_query=_stac_search_query(),
                                visualizations=[
                                    NamedVizParamsCreate(
                                        name="True Color",
                                        viz_params=VizParamsCreate(
                                            assets=["B04", "B03", "B02"],
                                            nodata=0,
                                            color_formula=(
                                                "Gamma RGB 3.2 Saturation 0.8 Sigmoidal RGB 25 0.35"
                                            ),
                                        ),
                                    ),
                                    NamedVizParamsCreate(
                                        name="False Color Infrared",
                                        viz_params=VizParamsCreate(
                                            assets=["B08", "B04", "B03"],
                                            nodata=0,
                                            color_formula=(
                                                "Gamma RGB 3.7 Saturation 1.5 Sigmoidal RGB 15 0.35"
                                            ),
                                        ),
                                    ),
                                ],
                            ),
                            slices=_monthly_slices(2024),
                        ),
                    ],
                ),
            ],
            basemaps=[],
        )

        # S2 NDVI timeseries (from Google Earth Engine)
        timeseries_configs = (
            [
                TimeSeriesCreate(
                    name="S2 NDVI",
                    start_ym="202401",
                    end_ym="202412",
                    data_source="SENTINEL2",
                    provider="EE",
                    ts_type="NDVI",
                ),
            ]
            if ensure_earth_engine()
            else []
        )
        if not timeseries_configs:
            logger.info("Earth Engine unavailable; skipping optional S2 NDVI timeseries")

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
            project_id=project.id,
            settings=settings,
            user_id=user.id,
            imagery_editor_state=imagery_editor_state,
            timeseries_configs=timeseries_configs,
        )
        logger.info("Campaign created: id=%d", campaign.id)
        _seed_default_view(db, campaign.id)

        logger.info("Creating and assigning 100 random sample tasks...")
        task_ids = _seed_tasks(db, campaign, user)

        # Open-mode campaign (same imagery & timeseries, no tasks)
        logger.info("Creating open-mode campaign via service...")
        open_campaign = create_campaign(
            db,
            name=OPEN_CAMPAIGN_NAME,
            mode="open",
            project_id=project.id,
            settings=settings,
            user_id=user.id,
            imagery_editor_state=imagery_editor_state,
            timeseries_configs=timeseries_configs,
        )
        logger.info("Open-mode campaign created: id=%d", open_campaign.id)
        _seed_default_view(db, open_campaign.id)

        logger.info("Waiting for imagery registration before exiting...")
        for campaign_id in (campaign.id, open_campaign.id):
            _wait_for_registration(db, campaign_id)

        logger.info("\nDatabase seeding complete!")
        logger.info("  Task-mode Campaign  : id=%d  name=%s", campaign.id, campaign.name)
        logger.info("  Open-mode Campaign  : id=%d  name=%s", open_campaign.id, open_campaign.name)
        logger.info("  User                : %s", user.email)
        logger.info("  Firebase UID        : %s", user.external_uid)
        logger.info("  Imagery items       : 1 source, 1 collection, 12 monthly slices")
        logger.info(
            "  Timeseries          : %s", "S2 NDVI (2024)" if timeseries_configs else "None"
        )
        logger.info("  Tasks (task-mode)   : %d", len(task_ids))
        logger.info("  Labels              : %d", len(settings.labels))

    finally:
        db.close()


def clear_dev_data():
    """Clear development data from the database."""
    db = SessionLocal()
    try:
        logger.info("Clearing development data...")

        org = db.scalar(select(Organization).where(Organization.name == "Dev Org"))
        if org:
            db.delete(org)
            logger.info("Deleted Dev Org (cascade removes projects and campaigns)")
        else:
            logger.info("No Dev Org found")

        db.commit()
        logger.info("Development data cleared.")

    finally:
        db.close()


def main():
    """Main entry point."""
    logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")

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
