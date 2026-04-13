import logging
import time
from dataclasses import dataclass
from datetime import datetime

import ee
from geoalchemy2.shape import to_shape
from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from src.annotation.models import (
    Annotation,
    AnnotationGeometry,
    AnnotationTask,
)
from src.annotation.models import (
    Embedding as EmbeddingRow,
)
from src.annotation.schemas import KnnValidationStatusOut, ValidateLabelSubmissionsResponse

logger = logging.getLogger(__name__)


@dataclass
class FetchedEmbedding:
    """Raw embedding fetched from an external provider (not yet persisted)."""

    vector: list[float]
    period_start: datetime
    period_end: datetime
    lat: float
    lon: float


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

        results[pid] = FetchedEmbedding(
            vector=vector,
            period_start=start_date,
            period_end=end_date,
            lat=coords[1],
            lon=coords[0],
        )

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


def store_embedding(
    db: Session,
    annotation_task_id: int,
    fetched: FetchedEmbedding,
) -> EmbeddingRow:
    """Persist a fetched embedding and link it to an annotation task."""
    row = EmbeddingRow(
        annotation_task_id=annotation_task_id,
        vector=fetched.vector,
        lat=fetched.lat,
        lon=fetched.lon,
        period_start=fetched.period_start,
        period_end=fetched.period_end,
    )
    db.add(row)
    db.flush()
    return row


def get_embeddings_by_campaign(db: Session, campaign_id: int) -> list[EmbeddingRow]:
    """Return all embeddings for tasks within a campaign."""
    stmt = (
        select(EmbeddingRow)
        .join(AnnotationTask, AnnotationTask.id == EmbeddingRow.annotation_task_id)
        .where(AnnotationTask.campaign_id == campaign_id)
    )
    return list(db.scalars(stmt).all())


def get_num_embeddings_with_label(
    db: Session,
    campaign_id: int,
    label_id: int | None = None,
) -> int:
    """Count embeddings linked to annotations that have a label set.

    If label_id is given, only count embeddings whose annotation carries
    that specific label. Otherwise count all labeled embeddings in the
    campaign.
    """
    stmt = (
        select(func.count(func.distinct(EmbeddingRow.id)))
        .join(AnnotationTask, AnnotationTask.id == EmbeddingRow.annotation_task_id)
        .join(Annotation, Annotation.annotation_task_id == AnnotationTask.id)
        .where(
            AnnotationTask.campaign_id == campaign_id,
            Annotation.label_id.isnot(None),
        )
    )
    if label_id is not None:
        stmt = stmt.where(Annotation.label_id == label_id)
    return db.scalar(stmt) or 0


def get_embeddings_by_label(db: Session, campaign_id: int, label_id: int) -> list[EmbeddingRow]:
    """Return all embeddings for a specific label within a campaign."""
    stmt = (
        select(EmbeddingRow)
        .join(AnnotationTask, AnnotationTask.id == EmbeddingRow.annotation_task_id)
        .join(Annotation, Annotation.annotation_task_id == AnnotationTask.id)
        .where(AnnotationTask.campaign_id == campaign_id, Annotation.label_id == label_id)
    )
    return list(db.scalars(stmt).all())


def find_nearest_labeled_embeddings(
    db: Session,
    campaign_id: int,
    target_vector: list[float],
    k: int = 10,
) -> list[tuple[EmbeddingRow, int, float]]:
    """Find the K nearest embeddings that have a labeled annotation.

    Only tasks with at least one annotation where label_id IS NOT NULL
    are considered. Returns (EmbeddingRow, label_id, cosine_distance)
    tuples ordered closest-first. The HNSW index is still used for the
    vector ordering; the extra JOIN just filters out unlabeled rows.
    """
    distance = EmbeddingRow.vector.cosine_distance(target_vector).label("distance")
    stmt = (
        select(EmbeddingRow, Annotation.label_id, distance)
        .join(AnnotationTask, AnnotationTask.id == EmbeddingRow.annotation_task_id)
        .join(Annotation, Annotation.annotation_task_id == AnnotationTask.id)
        .where(
            AnnotationTask.campaign_id == campaign_id,
            Annotation.label_id.isnot(None),
        )
        .order_by(distance)
        .limit(k)
    )
    return [(row, label, dist) for row, label, dist in db.execute(stmt).all()]


def get_embedding_by_task(
    db: Session,
    annotation_task_id: int,
) -> EmbeddingRow | None:
    """Return the embedding row for a given task, or None."""
    return db.scalars(
        select(EmbeddingRow).where(EmbeddingRow.annotation_task_id == annotation_task_id)
    ).first()


def knn_label_agrees(
    nearest: list[tuple[EmbeddingRow, int, float]],
    label_id: int,
) -> bool:
    """Return True if the majority label among nearest neighbours equals label_id.

    Expects tuples of (EmbeddingRow, label_id, distance) as returned by
    find_nearest_labeled_embeddings.
    """
    if not nearest:
        return True  # No labeled neighbors - nothing to disagree with

    neighbor_labels = [lbl for _, lbl, _ in nearest]
    most_common = max(set(neighbor_labels), key=neighbor_labels.count)
    logger.info("Neighbor labels: %s, most common: %s", neighbor_labels, most_common)
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
            func.count(func.distinct(EmbeddingRow.id)).label("total"),
            func.count(
                func.distinct(case((Annotation.label_id == label_id, EmbeddingRow.id)))
            ).label("label_count"),
        )
        .select_from(EmbeddingRow)
        .join(AnnotationTask, AnnotationTask.id == EmbeddingRow.annotation_task_id)
        .join(Annotation, Annotation.annotation_task_id == AnnotationTask.id)
        .where(
            AnnotationTask.campaign_id == campaign_id,
            Annotation.label_id.isnot(None),
        )
    )
    row = db.execute(total_stmt).one()
    total = row.total or 0
    label_count = row.label_count or 0
    return total >= 2 * n_neighbours and label_count >= n_neighbours


_N_NEIGHBOURS = 5


def get_validation_status(
    db: Session,
    campaign_id: int,
    embedding_year: int | None,
) -> KnnValidationStatusOut:
    """Summarize what the KNN validator has available for this campaign.

    Returns the thresholds and current counts (total + per-label) of
    distinct tasks that are both embedded and carry a labeled annotation.
    Counts are label-scoped the same way has_sufficient_validation_data is.
    """
    if embedding_year is None:
        return KnnValidationStatusOut(
            enabled=False,
            required_per_label=_N_NEIGHBOURS,
            required_total=2 * _N_NEIGHBOURS,
            total_labeled_with_embedding=0,
            per_label_counts={},
        )

    total_stmt = (
        select(func.count(func.distinct(EmbeddingRow.id)))
        .select_from(EmbeddingRow)
        .join(AnnotationTask, AnnotationTask.id == EmbeddingRow.annotation_task_id)
        .join(Annotation, Annotation.annotation_task_id == AnnotationTask.id)
        .where(
            AnnotationTask.campaign_id == campaign_id,
            Annotation.label_id.isnot(None),
        )
    )
    total = db.execute(total_stmt).scalar() or 0

    per_label_stmt = (
        select(
            Annotation.label_id,
            func.count(func.distinct(EmbeddingRow.id)).label("cnt"),
        )
        .select_from(EmbeddingRow)
        .join(AnnotationTask, AnnotationTask.id == EmbeddingRow.annotation_task_id)
        .join(Annotation, Annotation.annotation_task_id == AnnotationTask.id)
        .where(
            AnnotationTask.campaign_id == campaign_id,
            Annotation.label_id.isnot(None),
        )
        .group_by(Annotation.label_id)
    )
    rows = db.execute(per_label_stmt).all()
    per_label = {str(row.label_id): int(row.cnt) for row in rows}

    return KnnValidationStatusOut(
        enabled=True,
        required_per_label=_N_NEIGHBOURS,
        required_total=2 * _N_NEIGHBOURS,
        total_labeled_with_embedding=int(total),
        per_label_counts=per_label,
    )


def validate_label_submission(
    db: Session,
    campaign_id: int,
    annotation_task_id: int,
    label_id: int,
) -> ValidateLabelSubmissionsResponse:
    """Validate whether label_id agrees with KNN-majority for the task.

    Returns a structured response with a status field so callers can
    distinguish between a genuine mismatch and a skip due to missing data.
    """

    embedding = get_embedding_by_task(db, annotation_task_id)
    if not embedding:
        return ValidateLabelSubmissionsResponse(
            status="skipped_no_embedding",
            agrees=None,
        )

    if not has_sufficient_validation_data(db, campaign_id, label_id, _N_NEIGHBOURS):
        return ValidateLabelSubmissionsResponse(
            status="skipped_insufficient_data",
            agrees=None,
        )

    nearest = find_nearest_labeled_embeddings(
        db,
        campaign_id=campaign_id,
        target_vector=list(embedding.vector),
        k=_N_NEIGHBOURS,
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

    # Single query: tasks + geometry + whether embedding already exists
    stmt = (
        select(
            AnnotationTask.id.label("task_id"),
            AnnotationGeometry.geometry,
            func.bool_or(EmbeddingRow.id.isnot(None)).label("has_embedding"),
        )
        .join(AnnotationGeometry, AnnotationGeometry.id == AnnotationTask.geometry_id)
        .outerjoin(EmbeddingRow, EmbeddingRow.annotation_task_id == AnnotationTask.id)
        .where(AnnotationTask.campaign_id == campaign_id)
        .group_by(AnnotationTask.id, AnnotationGeometry.geometry)
    )
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

    # Store results - single bulk insert
    failed = len(points_to_fetch) - len(all_fetched)

    new_rows = [
        EmbeddingRow(
            annotation_task_id=int(task_id_str),
            vector=fetched.vector,
            lat=fetched.lat,
            lon=fetched.lon,
            period_start=fetched.period_start,
            period_end=fetched.period_end,
        )
        for task_id_str, fetched in all_fetched.items()
    ]
    logger.info("New embedding rows to insert: %d", len(new_rows))
    db.add_all(new_rows)
    db.flush()
    created = len(new_rows)

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
