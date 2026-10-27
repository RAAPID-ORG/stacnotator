"""
Development database seeding script.

Seeds a small, realistic workspace so the app looks the way it does in use:
an organization with a team of annotators and two projects.

  1. Kenya Smallholder Maize - a task campaign in western Kenya: six monthly
     Sentinel-2 windows (Jan-Jun 2025, weekly slices, true and false colour),
     60 sampled points assigned to three annotators each and partly answered,
     so the review, statistics and agreement pages have something to show.
     Also published as a visualizer.
  2. Ukraine Winter Crops - an explore campaign around Poltava with six
     windows over the 2024/25 season and points the team labelled freely.

Imagery is real Sentinel-2 from Microsoft Planetary Computer, registered by the
backend when the campaigns are created. The S2 NDVI time series is added when
Earth Engine is configured.

Usage:
    python seed_dev_data.py              # Seed (local auth: auto-creates local user,
                                         #        firebase auth: uses test UID)
    python seed_dev_data.py clear        # Clear seed data
    python seed_dev_data.py FIREBASE_UID # Seed with specific Firebase UID for initial user
"""

import logging
import random
import sys
import time
from calendar import monthrange
from datetime import UTC, datetime, timedelta

from shapely.geometry import box as shapely_box
from sqlalchemy import delete, insert, select, update
from sqlalchemy.orm import Session

import src.models  # noqa: F401 -- side-effect import: ensures all ORM models are registered before any mapper configures  # isort: skip

from src.annotation.models import Annotation
from src.annotation.schemas import AnnotationCreate, TaskAnswerCreate
from src.annotation.service import create_annotations, submit_task_annotation
from src.auth.constants import TERMS_VERSION
from src.auth.models import User
from src.auth.providers.firebase import FirebaseAuthProvider
from src.auth.providers.local import LOCAL_USER, LocalAuthProvider
from src.campaigns.models import Campaign
from src.campaigns.schemas import CampaignSettingsCreate, LabelBase
from src.campaigns.service import create_campaign
from src.config import get_settings
from src.database import SessionLocal
from src.earth_engine import ensure_earth_engine
from src.imagery.schemas import (
    BasemapCreate,
    CollectionSearchCreate,
    CollectionVisualizationCreate,
    ImageryCollectionCreate,
    ImageryEditorStateCreate,
    ImagerySliceCreate,
    ImagerySourceCreate,
    ImageryViewCreate,
    RenderParams,
    VisualizationCreate,
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
from src.projects.service import delete_project
from src.sampling_design.schemas import RandomSamplingConfig
from src.sampling_design.service import create_tasks_from_sampling_strategy
from src.tasks.models import Task, TaskAssignment, TaskSet
from src.tasks.task_sets import DEFAULT_TASK_SET_NAME
from src.tilers import registry
from src.timeseries.schemas import TimeseriesCreate
from src.visualizers import service as visualizer_service
from src.visualizers.schemas import VisualizerArea, VisualizerCreate, VisualizerImageryCreate

logger = logging.getLogger(__name__)

MPC_CATALOG_URL = "https://planetarycomputer.microsoft.com/api/stac/v1"

ORG_NAME = "Crop Monitoring Lab"
# Earlier versions of this script seeded "Dev Org"; clearing removes it too.
LEGACY_ORG_NAME = "Dev Org"
SEED_ISSUER = "seed"
ADMIN_NAME = "Alex Morgan"

# The team that answers tasks and labels points. Their accounts cannot sign in;
# they exist so the work has authors.
TEAM = [
    ("amina", "Amina Okafor"),
    ("lukas", "Lukas Becker"),
    ("priya", "Priya Raman"),
    ("mateo", "Mateo García"),
    ("sofia", "Sofia Kowalska"),
]

KENYA = dict(bbox_west=34.45, bbox_south=0.45, bbox_east=34.85, bbox_north=0.8)
POLTAVA = dict(bbox_west=33.85, bbox_south=49.45, bbox_east=34.35, bbox_north=49.75)

BASEMAPS = [
    BasemapCreate(
        name="Esri World Imagery",
        url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        max_native_zoom=18,
    ),
    BasemapCreate(
        name="OpenTopoMap",
        url="https://a.tile.opentopomap.org/{z}/{x}/{y}.png",
        max_native_zoom=17,
    ),
]

COMMENTS = [
    "Field edge runs through the point; labelled the larger side.",
    "Cloud in March, decided on the June windows.",
    "Looks like intercropping with beans.",
    "Homestead right next to the plot.",
    "Harvested by June, clearly cropland earlier.",
]


# ---------------------------------------------------------------------------
# Imagery
# ---------------------------------------------------------------------------


def _weekly_slices(year: int, month: int) -> list[ImagerySliceCreate]:
    """Four slices per month: three weeks and the rest of the month."""
    last = monthrange(year, month)[1]
    bounds = [(1, 7), (8, 14), (15, 21), (22, last)]
    return [
        ImagerySliceCreate(
            name=f"{datetime(year, month, start):%b} {start}-{end}",
            start_date=f"{year}-{month:02d}-{start:02d}",
            end_date=f"{year}-{month:02d}-{end:02d}",
        )
        for start, end in bounds
    ]


def _search_query(max_cloud_cover: int) -> dict:
    """Sentinel-2 L2A over a slice's dates, clearest scenes first, so MPC's
    first-valid mosaic shows the least cloudy pixels."""
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
                {"op": "<=", "args": [{"property": "eo:cloud_cover"}, max_cloud_cover]},
            ],
        },
        "filterLang": "cql2-json",
        "sortby": [{"field": "eo:cloud_cover", "direction": "asc"}],
    }


def _sentinel2_source(name: str, months: list[tuple[int, int]], max_cloud_cover: int):
    """One Sentinel-2 source with a window per month, true and false colour."""
    return ImagerySourceCreate(
        name=name,
        crosshair_hex6="FF3B30",
        default_zoom=15,
        visualizations=[
            VisualizationCreate(name="True Color"),
            VisualizationCreate(name="False Color"),
        ],
        collections=[
            ImageryCollectionCreate(
                name=f"{datetime(year, month, 1):%b %Y}",
                cover_slice_index=1,
                search=CollectionSearchCreate(
                    catalog_url=MPC_CATALOG_URL,
                    stac_collection_id="sentinel-2-l2a",
                    max_cloud_cover=max_cloud_cover,
                    search_query=_search_query(max_cloud_cover),
                ),
                visualizations=[
                    CollectionVisualizationCreate(
                        visualization="True Color",
                        params=RenderParams(
                            assets=["B04", "B03", "B02"],
                            nodata=0,
                            color_formula="Gamma RGB 3.2 Saturation 0.8 Sigmoidal RGB 25 0.35",
                        ),
                    ),
                    CollectionVisualizationCreate(
                        visualization="False Color",
                        params=RenderParams(
                            assets=["B08", "B04", "B03"],
                            nodata=0,
                            color_formula="Gamma RGB 3.7 Saturation 1.5 Sigmoidal RGB 15 0.35",
                        ),
                    ),
                ],
                slices=_weekly_slices(year, month),
            )
            for year, month in months
        ],
    )


def _ndvi(start_ym: str, end_ym: str) -> list[TimeseriesCreate]:
    if not ensure_earth_engine():
        logger.info("Earth Engine unavailable; skipping the S2 NDVI time series")
        return []
    return [
        TimeseriesCreate(
            name="S2 NDVI",
            start_ym=start_ym,
            end_ym=end_ym,
            data_source="SENTINEL2",
            ts_type="NDVI",
        )
    ]


# ---------------------------------------------------------------------------
# People and places
# ---------------------------------------------------------------------------


def _ensure_admin(db: Session, firebase_uid: str | None = None) -> User:
    """Return the signed-in user, created if missing, as a platform admin.

    In local auth mode this is the fixed user LocalAuthProvider authenticates as.
    """
    if get_settings().AUTH_PROVIDER == "local":
        issuer, external_uid, email = (
            LocalAuthProvider.name,
            LOCAL_USER["uid"],
            LOCAL_USER["email"],
        )
    else:
        issuer = FirebaseAuthProvider.name
        external_uid = firebase_uid or "dev-test-uid"
        email = f"dev-{external_uid}@test.com"

    user = db.execute(
        select(User).where(User.issuer == issuer, User.external_uid == external_uid)
    ).scalar_one_or_none()
    if user is None:
        user = User(issuer=issuer, external_uid=external_uid, email=email)
        db.add(user)
    user.is_platform_admin = True
    # A dev database starts past the terms prompt.
    user.terms_accepted_version = TERMS_VERSION
    if not user.display_name or user.display_name in ("Local Admin", "Dev Test User"):
        user.display_name = ADMIN_NAME
    db.flush()
    return user


def _ensure_team(db: Session) -> list[User]:
    team = []
    for handle, name in TEAM:
        user = db.execute(
            select(User).where(User.issuer == SEED_ISSUER, User.external_uid == handle)
        ).scalar_one_or_none()
        if user is None:
            user = User(
                issuer=SEED_ISSUER,
                external_uid=handle,
                email=f"{handle}@cropmonitoring.example",
                display_name=name,
            )
            db.add(user)
        team.append(user)
    db.flush()
    return team


def _ensure_org(db: Session, admin: User, team: list[User]) -> Organization:
    org = db.scalar(select(Organization).where(Organization.name == ORG_NAME))
    if org is None:
        org = Organization(
            name=ORG_NAME,
            description="Field-level crop mapping for food-security monitoring",
            status=ORG_STATUS_APPROVED,
            allows_internal_storage=True,
            created_by=admin.id,
        )
        db.add(org)
        db.flush()
        for tiler_name in registry.all_names():
            db.add(OrganizationTiler(organization_id=org.id, tiler_name=tiler_name))
    members = {
        m.user_id
        for m in db.scalars(
            select(OrganizationUser).where(OrganizationUser.organization_id == org.id)
        )
    }
    for user in [admin, *team]:
        if user.id not in members:
            db.add(
                OrganizationUser(
                    user_id=user.id,
                    organization_id=org.id,
                    is_admin=user is admin,
                    status=MEMBER_STATUS_ACTIVE,
                )
            )
    db.flush()
    return org


def _fresh_project(
    db: Session, org: Organization, admin: User, team: list[User], name: str, description: str
) -> Project:
    """The project, recreated with the admin and the team as its members."""
    existing = db.scalar(
        select(Project).where(Project.organization_id == org.id, Project.name == name)
    )
    if existing is not None:
        logger.info("Project '%s' exists - recreating it...", name)
        delete_project(db, existing.id)
    project = Project(
        organization_id=org.id, name=name, description=description, created_by=admin.id
    )
    db.add(project)
    db.flush()
    db.add(
        ProjectUser(
            user_id=admin.id, project_id=project.id, is_admin=True, is_authoritative_reviewer=True
        )
    )
    for user in team:
        db.add(ProjectUser(user_id=user.id, project_id=project.id, is_admin=False))
    db.commit()
    return project


def _default_view(db: Session, campaign: Campaign, name: str) -> None:
    """One view over every source, so annotation works without authoring one."""
    create_view(
        db,
        campaign,
        ImageryViewCreate(name=name, source_ids=[source.id for source in campaign.imagery_sources]),
    )


# ---------------------------------------------------------------------------
# Work
# ---------------------------------------------------------------------------


def _backdate(db: Session, annotation_id: int, rng: random.Random) -> None:
    """Spread the work over the last weeks, so activity reads like a campaign in use."""
    at = datetime.now(UTC) - timedelta(days=rng.uniform(0, 21), hours=rng.uniform(0, 8))
    db.execute(
        update(Annotation)
        .where(Annotation.id == annotation_id)
        .values(created_at=at, updated_at=at)
    )


def _answer_tasks(db: Session, campaign: Campaign, team: list[User], rng: random.Random) -> int:
    """Assign every task to three of the team and answer about two thirds of them:
    mostly in agreement, some conflicts, a few skips, comments and one flag."""
    tasks = list(
        db.scalars(
            select(Task).where(Task.campaign_id == campaign.id).order_by(Task.annotation_number)
        )
    )
    crew = {task.id: rng.sample(team, 3) for task in tasks}
    db.execute(
        insert(TaskAssignment),
        [{"task_id": task.id, "user_id": user.id} for task in tasks for user in crew[task.id]],
    )
    db.commit()

    labels = [1, 2, 3]  # Cropland, Non-cropland, Uncertain
    answered = 0
    flagged = False
    for task in tasks:
        roll = rng.random()
        if roll < 0.3:
            continue  # still open
        annotators = crew[task.id] if roll > 0.45 else crew[task.id][: rng.randint(1, 2)]
        truth = rng.choices(labels, weights=[55, 37, 8])[0]
        for user in annotators:
            if rng.random() < 0.04:
                answer = TaskAnswerCreate(outcome="skipped", active_ms=rng.randint(5_000, 20_000))
            else:
                label = (
                    truth if rng.random() < 0.86 else rng.choice([x for x in labels if x != truth])
                )
                flag = not flagged and label == 3
                flagged = flagged or flag
                answer = TaskAnswerCreate(
                    label_id=label,
                    confidence=rng.choices([2, 3, 4, 5], weights=[1, 3, 5, 6])[0],
                    comment=rng.choice(COMMENTS) if rng.random() < 0.12 else None,
                    flagged_for_review=flag or None,
                    flag_comment="Could be a fallow field - second opinion?" if flag else None,
                    active_ms=rng.randint(12_000, 95_000),
                )
            response = submit_task_annotation(db, campaign, task.id, answer, user.id)
            _backdate(db, response.annotation.id, rng)
            answered += 1
    db.commit()
    return answered


def _label_points(
    db: Session, campaign: Campaign, team: list[User], bbox: dict, rng: random.Random
) -> int:
    """Points the team labelled freely across the campaign area."""
    labels = [1, 2, 3]  # Winter cereal, Rapeseed, Non-crop
    count = 0
    for user in team[:4]:
        points = [
            AnnotationCreate(
                label_id=rng.choices(labels, weights=[5, 3, 2])[0],
                confidence=rng.choice([3, 4, 5]),
                geometry_wkt=(
                    f"POINT({rng.uniform(bbox['bbox_west'], bbox['bbox_east']):.6f} "
                    f"{rng.uniform(bbox['bbox_south'], bbox['bbox_north']):.6f})"
                ),
            )
            for _ in range(rng.randint(6, 10))
        ]
        for annotation in create_annotations(db, campaign, points, user.id):
            _backdate(db, annotation.id, rng)
        count += len(points)
    db.commit()
    return count


def _wait_for_registration(db: Session, campaign_id: int, timeout: float = 600) -> None:
    deadline = time.monotonic() + timeout
    while True:
        db.expire_all()
        campaign = db.get(Campaign, campaign_id)
        if campaign is None:
            raise RuntimeError(f"Seeded campaign {campaign_id} no longer exists")
        status, errors = campaign.registration_status, campaign.registration_errors
        db.rollback()
        if status == "ready":
            return
        if status not in ("registering", "pending"):
            raise RuntimeError(f"Imagery registration failed for campaign {campaign_id}: {errors}")
        if time.monotonic() >= deadline:
            raise TimeoutError(f"Imagery registration timed out for campaign {campaign_id}")
        time.sleep(2)


# ---------------------------------------------------------------------------
# Entry points
# ---------------------------------------------------------------------------


def seed_dev_data(firebase_uid: str | None = None):
    """Seed the demo workspace. Re-running replaces the seeded projects.

    Args:
        firebase_uid: Optional Firebase UID. Ignored in local auth mode.
                      If not provided in firebase mode, uses a test UID.
    """
    rng = random.Random(7)  # noqa: S311 -- reproducible demo data, not security
    db = SessionLocal()
    try:
        logger.info("Starting database seeding...")
        admin = _ensure_admin(db, firebase_uid)
        team = _ensure_team(db)
        org = _ensure_org(db, admin, team)

        # Kenya: a task campaign, answered by the team.
        kenya_project = _fresh_project(
            db,
            org,
            admin,
            team,
            "Kenya Smallholder Maize",
            "Cropland reference labels for the long-rains season in western Kenya",
        )
        kenya = create_campaign(
            db,
            name="Bungoma Long Rains 2025",
            project_id=kenya_project.id,
            settings=CampaignSettingsCreate(
                labels=[
                    LabelBase(id=1, name="Cropland", geometry_type="point"),
                    LabelBase(id=2, name="Non-cropland", geometry_type="point"),
                    LabelBase(id=3, name="Uncertain", geometry_type="point"),
                ],
                sample_extent_meters=100,
                **KENYA,
            ),
            user_id=admin.id,
            imagery_editor_state=ImageryEditorStateCreate(
                sources=[
                    _sentinel2_source(
                        "Sentinel-2 L2A", [(2025, m) for m in range(1, 7)], max_cloud_cover=40
                    )
                ],
                basemaps=BASEMAPS,
            ),
            timeseries_configs=_ndvi("202501", "202506"),
        )
        kenya.guide_markdown = (
            "## Cropland or not?\n\n"
            "Label the **100 m square** around the point. *Cropland* is any field planted "
            "this season, including intercropped and recently harvested plots. Use the "
            "false-colour windows to tell crops from grassland."
        )
        _default_view(db, kenya, "Sentinel-2")
        task_set_id = db.execute(
            select(TaskSet.id).where(
                TaskSet.campaign_id == kenya.id, TaskSet.name == DEFAULT_TASK_SET_NAME
            )
        ).scalar_one()
        create_tasks_from_sampling_strategy(
            db,
            kenya,
            RandomSamplingConfig(num_samples=60, seed=11),
            shapely_box(
                KENYA["bbox_west"], KENYA["bbox_south"], KENYA["bbox_east"], KENYA["bbox_north"]
            ),
            task_set_id,
        )
        db.commit()
        answers = _answer_tasks(db, kenya, team, rng)

        visualizer = visualizer_service.create(
            db,
            kenya_project,
            VisualizerCreate(
                name="Bungoma Cropland 2025",
                description="Sentinel-2 over the long-rains season in Bungoma County",
                is_public=True,
                area=VisualizerArea(
                    west=KENYA["bbox_west"],
                    south=KENYA["bbox_south"],
                    east=KENYA["bbox_east"],
                    north=KENYA["bbox_north"],
                ),
                imagery=[VisualizerImageryCreate(source_id=kenya.imagery_sources[0].id)],
            ),
            admin.id,
        )

        # Ukraine: an explore campaign with freely labelled points.
        ukraine_project = _fresh_project(
            db,
            org,
            admin,
            team,
            "Ukraine Winter Crops",
            "Winter cereal and rapeseed mapping for the 2024/25 season",
        )
        poltava = create_campaign(
            db,
            name="Poltava Winter Crops 2025",
            project_id=ukraine_project.id,
            settings=CampaignSettingsCreate(
                labels=[
                    LabelBase(id=1, name="Winter cereal", geometry_type="point"),
                    LabelBase(id=2, name="Rapeseed", geometry_type="point"),
                    LabelBase(id=3, name="Non-crop", geometry_type="point"),
                ],
                **POLTAVA,
            ),
            user_id=admin.id,
            imagery_editor_state=ImageryEditorStateCreate(
                sources=[
                    _sentinel2_source(
                        "Sentinel-2 L2A",
                        [(2024, 10), (2024, 11), (2025, 2), (2025, 3), (2025, 4), (2025, 5)],
                        max_cloud_cover=30,
                    )
                ],
                basemaps=BASEMAPS,
            ),
            timeseries_configs=_ndvi("202410", "202505"),
        )
        _default_view(db, poltava, "Sentinel-2")
        points = _label_points(db, poltava, team, POLTAVA, rng)

        logger.info("Waiting for imagery registration (this calls Planetary Computer)...")
        for campaign_id in (kenya.id, poltava.id):
            _wait_for_registration(db, campaign_id)

        logger.info("\nDatabase seeding complete!")
        logger.info("  Organization : %s (%d people)", ORG_NAME, len(team) + 1)
        logger.info(
            "  Task campaign    : /projects/%d/campaigns/%d  (60 tasks, %d answers)",
            kenya_project.id,
            kenya.id,
            answers,
        )
        logger.info(
            "  Explore campaign : /projects/%d/campaigns/%d  (%d points)",
            ukraine_project.id,
            poltava.id,
            points,
        )
        logger.info("  Visualizer       : /v/%s", visualizer.slug)
        logger.info("  Signed in as     : %s (%s)", admin.display_name, admin.email)
    finally:
        db.close()


def clear_dev_data():
    """Remove the seeded organization, its projects and the seeded team."""
    db = SessionLocal()
    try:
        logger.info("Clearing development data...")
        for name in (ORG_NAME, LEGACY_ORG_NAME):
            org = db.scalar(select(Organization).where(Organization.name == name))
            if org is not None:
                for project_id in db.scalars(
                    select(Project.id).where(Project.organization_id == org.id)
                ).all():
                    delete_project(db, project_id)
                db.delete(org)
                logger.info("Deleted %s with its projects and campaigns", name)
        db.execute(delete(User).where(User.issuer == SEED_ISSUER))
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
        seed_dev_data(sys.argv[1])
    else:
        seed_dev_data()


if __name__ == "__main__":
    main()
