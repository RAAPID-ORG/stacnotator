import logging
import time
from dataclasses import dataclass
from datetime import datetime

import ee
from geoalchemy2.shape import to_shape
from sqlalchemy import case, func, select, update
from sqlalchemy.orm import Session

from src import background
from src.annotation.constants import EMBD_MIN_N_NEIGHBOURS
from src.annotation.models import Annotation
from src.campaigns.models import Campaign
from src.earth_engine import ensure_earth_engine
from src.imagery.registration import sanitize_error_message
from src.tasks.models import Task
from src.tasks.schemas import ValidateLabelSubmissionsResponse

logger = logging.getLogger(__name__)


@dataclass
class FetchedEmbedding:
    """Raw embedding fetched from an external provider (not yet persisted)."""

    vector: list[float]


_ALPHAEARTH_BANDS = [f"A{i:02d}" for i in range(64)]
_ALPHAEARTH_COLLECTION = "GOOGLE/SATELLITE_EMBEDDING/V1/ANNUAL"
_GEE_BATCH_SIZE = 500  # GEE sampleRegions has a limit on features per call
_GEE_MAX_ATTEMPTS = 5
_GEE_RETRY_BASE_DELAY = 2.0  # seconds; doubled each attempt (2, 4, 8, 16)


def _fetch_alphaearth_gee_batch(
    points: list[dict],
    start_date: datetime,
    end_date: datetime,
) -> dict[str, FetchedEmbedding]:
    """Fetch 64-D AlphaEarth embeddings for many points in one GEE call.

    points is a list of dicts with keys "id", "lat", "lon".
    Returns a dict mapping point "id" -> FetchedEmbedding.
    Missing / failed points are omitted from the result.
    """
    if not points:
        return {}

    features = [
        ee.Feature(ee.Geometry.Point([p["lon"], p["lat"]]), {"pid": p["id"]}) for p in points
    ]
    fc = ee.FeatureCollection(features)

    mosaic = (
        ee.ImageCollection(_ALPHAEARTH_COLLECTION)
        .filterDate(start_date.isoformat(), end_date.isoformat())
        .select(_ALPHAEARTH_BANDS)
        .mosaic()
    )

    sampled = mosaic.sampleRegions(
        collection=fc,
        scale=10,
        geometries=True,
    )

    results: dict[str, FetchedEmbedding] = {}

    # Single getInfo() call - all points come back at once.
    # Retried with exponential backoff: GEE is occasionally flaky with 429/500s
    # on large sampleRegions calls, and one transient failure shouldn't drop
    # an entire 500-point batch.
    sampled_info = None
    for attempt in range(1, _GEE_MAX_ATTEMPTS + 1):
        try:
            sampled_info = sampled.getInfo()
            break
        except Exception as exc:
            if attempt == _GEE_MAX_ATTEMPTS:
                point_ids = [str(p.get("id")) for p in points]
                logger.exception(
                    "GEE embedding fetch failed after %d attempts for %d point(s) (ids=%s): %s",
                    _GEE_MAX_ATTEMPTS,
                    len(points),
                    ",".join(point_ids),
                    exc,
                )
                return results
            delay = _GEE_RETRY_BASE_DELAY * (2 ** (attempt - 1))
            logger.warning(
                "GEE embedding fetch attempt %d/%d failed for %d point(s), retrying in %.1fs: %s",
                attempt,
                _GEE_MAX_ATTEMPTS,
                len(points),
                delay,
                exc,
            )
            time.sleep(delay)

    if sampled_info is None:
        logger.warning(
            "GEE embedding fetch returned no data for %d point(s).",
            len(points),
        )
        return results

    returned_pids: set[str] = set()
    zero_vector_points: list[dict] = []

    for feature in sampled_info["features"]:
        props = feature["properties"]
        pid = props["pid"]
        coords = feature["geometry"]["coordinates"]
        returned_pids.add(pid)

        vector = [props.get(band, 0.0) for band in _ALPHAEARTH_BANDS]

        # All-zero vector means the underlying AlphaEarth pixel was masked / no data.
        if all(v == 0.0 for v in vector):
            zero_vector_points.append({"id": pid, "lat": coords[1], "lon": coords[0]})
            continue

        results[pid] = FetchedEmbedding(vector=vector)

    # Diagnostic: distinguish "dropped by sampleRegions" from "all-zero vector".
    # Both are deterministic "no data" - retrying won't help; these are real
    # coverage gaps in GOOGLE/SATELLITE_EMBEDDING/V1/ANNUAL for the given year.
    missing_pids = [p["id"] for p in points if p["id"] not in returned_pids]
    if missing_pids:
        missing_coords = [
            {"id": p["id"], "lat": p["lat"], "lon": p["lon"]}
            for p in points
            if p["id"] in set(missing_pids)
        ]
        logger.warning(
            "AlphaEarth %s-%s: %d point(s) missing from sampleRegions output "
            "(not retryable - point outside mosaic extent). Sample: %s",
            start_date.date(),
            end_date.date(),
            len(missing_pids),
            missing_coords[:5],
        )
    if zero_vector_points:
        logger.warning(
            "AlphaEarth %s-%s: %d point(s) returned all-zero vector "
            "(not retryable - pixel masked / no data). Sample: %s",
            start_date.date(),
            end_date.date(),
            len(zero_vector_points),
            zero_vector_points[:5],
        )

    return results


def find_nearest_labeled_embeddings(
    db: Session,
    campaign_id: int,
    target_vector: list[float],
    k: int = 10,
) -> list[tuple[int, int, float]]:
    """The K tasks nearest the target that someone has labelled, as (task id, label,
    cosine distance), closest first. The HNSW index orders by distance; the join only
    filters out unlabelled tasks."""
    distance = Task.embedding.cosine_distance(target_vector).label("distance")
    stmt = (
        select(Task.id, Annotation.label_id, distance)
        .join(Annotation, Annotation.task_id == Task.id)
        .where(
            Task.campaign_id == campaign_id,
            Task.embedding.is_not(None),
            Annotation.label_id.is_not(None),
        )
        .order_by(distance)
        .limit(k)
    )
    return [(task_id, label, dist) for task_id, label, dist in db.execute(stmt).all()]


def task_embedding(db: Session, campaign_id: int, task_id: int) -> list[float] | None:
    """A task's embedding, or None when it has none yet.

    The task id reaches this module straight off the URL, and the route's gate
    only proves the caller may see ``campaign_id`` - not that the task belongs to
    it. Taking the campaign as an argument is what keeps the pair checked here
    rather than assumed from the caller, as every other query in this module does.
    """
    vector = db.scalar(
        select(Task.embedding).where(
            Task.id == task_id,
            Task.campaign_id == campaign_id,
        )
    )
    return None if vector is None else list(vector)


def knn_label_agrees(nearest: list[tuple[int, int, float]], label_id: int) -> bool:
    """Return True if the majority label among nearest neighbours equals label_id.

    Expects tuples of (task id, label_id, distance) as returned by
    find_nearest_labeled_embeddings.
    """
    if not nearest:
        return True  # No labeled neighbors - nothing to disagree with

    neighbor_labels = [lbl for _, lbl, _ in nearest]
    most_common = max(set(neighbor_labels), key=neighbor_labels.count)
    logger.debug("Neighbor labels: %s, most common: %s", neighbor_labels, most_common)
    return most_common == label_id


def has_sufficient_validation_data(
    db: Session,
    campaign_id: int,
    label_id: int,
    n_neighbours: int,
) -> bool:
    """Check if enough reference data is available to compare against.

    Returns True only if:
    - at least 2 * n_neighbours total labeled embeddings exist in the campaign, AND
    - at least n_neighbours embeddings with the specific label_id exist.

    Uses a single query with conditional aggregation for efficiency.
    """
    # Single query: count total labeled embeddings AND per-label embeddings
    total_stmt = (
        select(
            func.count(func.distinct(Task.id)).label("total"),
            func.count(func.distinct(case((Annotation.label_id == label_id, Task.id)))).label(
                "label_count"
            ),
        )
        .select_from(Task)
        .join(Annotation, Annotation.task_id == Task.id)
        .where(
            Task.campaign_id == campaign_id,
            Task.embedding.is_not(None),
            Annotation.label_id.is_not(None),
        )
    )
    row = db.execute(total_stmt).one()
    total = row.total or 0
    label_count = row.label_count or 0
    return total >= 2 * n_neighbours and label_count >= n_neighbours


def validate_label_submission(
    db: Session,
    campaign_id: int,
    task_id: int,
    label_id: int,
) -> ValidateLabelSubmissionsResponse:
    """Validate whether label_id agrees with KNN-majority for the task.

    Returns a structured response with a status field so callers can
    distinguish between a genuine mismatch and a skip due to missing data.
    """

    embedding = task_embedding(db, campaign_id, task_id)
    if embedding is None:
        return ValidateLabelSubmissionsResponse(
            status="skipped_no_embedding",
            agrees=None,
        )

    if not has_sufficient_validation_data(db, campaign_id, label_id, EMBD_MIN_N_NEIGHBOURS):
        return ValidateLabelSubmissionsResponse(
            status="skipped_insufficient_data",
            agrees=None,
        )

    nearest = find_nearest_labeled_embeddings(
        db,
        campaign_id=campaign_id,
        target_vector=embedding,
        k=EMBD_MIN_N_NEIGHBOURS,
    )

    agrees = knn_label_agrees(nearest, label_id)

    return ValidateLabelSubmissionsResponse(
        status="ok" if agrees else "mismatch",
        agrees=agrees,
    )


def populate_campaign_embeddings(
    db: Session,
    campaign_id: int,
    start_date: datetime,
    end_date: datetime,
    provider: str = "alphaearth_gee",
) -> dict:
    """Fetch and store embeddings for every task in a campaign (if not already present)."""
    if provider != "alphaearth_gee":
        raise NotImplementedError(f"Batch fetch not implemented for '{provider}'.")

    stmt = select(
        Task.id.label("task_id"),
        Task.geometry,
        Task.embedding.is_not(None).label("has_embedding"),
    ).where(Task.campaign_id == campaign_id)
    rows = db.execute(stmt).all()

    # Build the list of GEE-points to fetch
    points_to_fetch: list[dict] = []
    skipped = 0

    for row in rows:
        if row.has_embedding:
            skipped += 1
            continue

        shape = to_shape(row.geometry)
        centroid = shape.centroid
        points_to_fetch.append(
            {
                "id": str(row.task_id),
                "lat": centroid.y,
                "lon": centroid.x,
            }
        )

    logger.info(
        "Fetching embeddings for campaign %d: %d points to fetch, %d already have embeddings.",
        campaign_id,
        len(points_to_fetch),
        skipped,
    )

    # Batch-fetch from GEE. Limited by max size from GEE
    all_fetched: dict[str, FetchedEmbedding] = {}
    for i in range(0, len(points_to_fetch), _GEE_BATCH_SIZE):
        batch = points_to_fetch[i : i + _GEE_BATCH_SIZE]
        logger.info(
            "Fetching embeddings batch %d-%d of %d",
            i + 1,
            i + len(batch),
            len(points_to_fetch),
        )
        try:
            all_fetched.update(_fetch_alphaearth_gee_batch(batch, start_date, end_date))
        except Exception as exc:
            point_ids = [str(p.get("id")) for p in batch]
            logger.exception(
                "Embedding batch fetch failed for %d point(s) (ids=%s): %s",
                len(batch),
                ",".join(point_ids),
                exc,
            )

    failed = len(points_to_fetch) - len(all_fetched)
    if all_fetched:
        db.execute(
            update(Task),
            [
                {"id": int(task_id), "embedding": fetched.vector}
                for task_id, fetched in all_fetched.items()
            ],
        )
    created = len(all_fetched)

    total = len(rows)
    summary = {
        "created": created,
        "skipped": skipped,
        "failed": failed,
        "total": total,
    }
    logger.info(
        "Populated embeddings for campaign %d: %d created, %d skipped, %d failed out of %d tasks",
        campaign_id,
        created,
        skipped,
        failed,
        total,
    )
    return summary


# The embeddings domain's background run on the campaign.
EMBEDDING_RUN = background.StatusField(
    model=Campaign,
    status_column="embedding_status",
    heartbeat_column="embedding_heartbeat_at",
    errors_column="embedding_errors",
    interrupted_error=(
        "Embedding computation was interrupted by a server restart. "
        "Trigger it again from the campaign settings to retry."
    ),
)


def spawn_background_embedding_computation(campaign_id: int, year: int) -> None:
    """Run embedding computation off the request path (see src/background.py).

    The caller commits begin_status_run(campaign, EMBEDDING_RUN) in its own
    transaction before calling this; the spawned run flips the status to
    ready/failed once populate_campaign_embeddings finishes (or fails).
    """
    start_date = datetime(year, 1, 1)
    end_date = datetime(year, 12, 31)

    def work(db: Session) -> None:
        if not ensure_earth_engine():
            raise RuntimeError(
                "Earth Engine is unavailable (initialization failed); "
                "retry the embedding computation"
            )
        populate_campaign_embeddings(db, campaign_id, start_date, end_date)

    background.spawn_status_run(
        campaign_id,
        EMBEDDING_RUN,
        name="embedding computation",
        work=work,
        sanitize_error=lambda exc: sanitize_error_message(
            exc, fallback="Embedding computation failed"
        ),
    )


def start_embedding_run(db: Session, campaign: Campaign) -> None:
    """Fetch embeddings for every task of the campaign that has none yet, off the
    request path. Commits the run's start; a no-op for a campaign without an
    embedding year."""
    year = campaign.embedding_year
    if year is None:
        return
    background.begin_status_run(campaign, EMBEDDING_RUN)
    campaign.embedding_errors = None
    db.commit()
    spawn_background_embedding_computation(campaign.id, year)
