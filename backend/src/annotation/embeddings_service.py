from dataclasses import dataclass
from datetime import datetime
import logging

from src.annotation.schema import ValidateLabelSubmissionsResponse
import ee
from geoalchemy2.shape import to_shape
from sqlalchemy import select, func
from sqlalchemy.orm import Session

from src.annotation.models import (
    Annotation,
    AnnotationGeometry,
    AnnotationTask,
    Embedding as EmbeddingRow,
)

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
_GEE_BATCH_SIZE = 500 # GEE sampleRegions has a limit on features per call


def _fetch_alphaearth_gee_batch(
    points: list[dict],
    start_date: datetime,
    end_date: datetime,
) -> dict[str, FetchedEmbedding]:
    """Fetch 64-D AlphaEarth embeddings for many points in one GEE call.

    *points* is a list of dicts with keys ``id``, ``lat``, ``lon``.
    Returns a dict mapping point ``id`` -> ``FetchedEmbedding``.
    Missing / failed points are omitted from the result.
    """
    if not points:
        return {}

    features = [
        ee.Feature(ee.Geometry.Point([p["lon"], p["lat"]]), {"pid": p["id"]})
        for p in points
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

    # Single getInfo() call - all points come back at once
    try:
        sampled_info = sampled.getInfo()
    except Exception as exc:
        point_ids = [str(p.get("id")) for p in points]
        logger.exception(
            "GEE embedding fetch failed for %d point(s) (ids=%s): %s",
            len(points), ",".join(point_ids), exc,
        )
        return results

    if sampled_info is None:
        logger.warning(
            "GEE embedding fetch returned no data for %d point(s).",
            len(points),
        )
        return results

    for feature in sampled_info["features"]:
        props = feature["properties"]
        pid = props["pid"]
        coords = feature["geometry"]["coordinates"]

        vector = [props.get(band, 0.0) for band in _ALPHAEARTH_BANDS]

        # Skip if all zeros (no data at this location)
        if all(v == 0.0 for v in vector):
            continue

        results[pid] = FetchedEmbedding(
            vector=vector,
            period_start=start_date,
            period_end=end_date,
            lat=coords[1],
            lon=coords[0],
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


def get_embeddings_by_campaign(
    db: Session, campaign_id: int
) -> list[EmbeddingRow]:
    """Return all embeddings for tasks within a campaign."""
    stmt = (
        select(EmbeddingRow)
        .join(AnnotationTask, AnnotationTask.id == EmbeddingRow.annotation_task_id)
        .where(AnnotationTask.campaign_id == campaign_id)
    )
    return list(db.scalars(stmt).all())


def get_embeddings_by_label(
    db: Session, campaign_id: int, label_id: int
) -> list[EmbeddingRow]:
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

    Only tasks with at least one annotation where ``label_id IS NOT NULL``
    are considered.  Returns ``(EmbeddingRow, label_id, cosine_distance)``
    tuples ordered closest-first.  The HNSW index is still used for the
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
        select(EmbeddingRow).where(
            EmbeddingRow.annotation_task_id == annotation_task_id
        )
    ).first()


def knn_label_agrees(
    nearest: list[tuple[EmbeddingRow, int, float]],
    label_id: int,
) -> bool:
    """Return True if the majority label among *nearest* neighbours equals *label_id*.

    Expects tuples of ``(EmbeddingRow, label_id, distance)`` as returned by
    ``find_nearest_labeled_embeddings``.
    """
    if not nearest:
        return True  # No labeled neighbors - nothing to disagree with

    neighbor_labels = [lbl for _, lbl, _ in nearest]
    most_common = max(set(neighbor_labels), key=neighbor_labels.count)
    logger.info("Neighbor labels: %s, most common: %s", neighbor_labels, most_common)
    return most_common == label_id


def validate_label_submission(
    db: Session,
    annotation_id: int,
    label_id: int,
) -> ValidateLabelSubmissionsResponse:
    """Validate if a submitted label is correct based on nearest embedding."""
    annotation = db.get(Annotation, annotation_id)
    if not annotation:
        raise ValueError(f"Annotation {annotation_id} not found.")
    if not annotation.annotation_task_id:
        raise ValueError(f"Annotation {annotation_id} has no task.")

    embedding = get_embedding_by_task(db, annotation.annotation_task_id)
    if not embedding:
        raise ValueError(f"No embedding found for task of annotation {annotation_id}.")

    nearest = find_nearest_labeled_embeddings(
        db,
        campaign_id=annotation.campaign_id,
        target_vector=list(embedding.vector),
        k=5,
    )

    agrees = knn_label_agrees(nearest, label_id)

    return {
        "agrees": agrees,
    }


def populate_campaign_embeddings(
    db: Session,
    campaign_id: int,
    start_date: datetime,
    end_date: datetime,
    provider: str = "alphaearth_gee",
) -> dict:
    """Fetch and store embeddings for every task in a campaign (if not already present).
    """
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
        points_to_fetch.append({
            "id": str(row.task_id),
            "lat": centroid.y,
            "lon": centroid.x,
        })

    logger.info(f"Fetching embeddings for campaign {campaign_id}: {len(points_to_fetch)} points to fetch, {skipped} already have embeddings.")

    # Batch-fetch from GEE. Limitied by max size from GEE
    all_fetched: dict[str, FetchedEmbedding] = {}
    for i in range(0, len(points_to_fetch), _GEE_BATCH_SIZE):
        batch = points_to_fetch[i : i + _GEE_BATCH_SIZE]
        logger.info(
            "Fetching embeddings batch %d-%d of %d",
            i + 1, i + len(batch), len(points_to_fetch),
        )
        try:
            all_fetched.update(
                _fetch_alphaearth_gee_batch(batch, start_date, end_date)
            )
        except Exception as exc:
            point_ids = [str(p.get("id")) for p in batch]
            logger.exception(
                "Embedding batch fetch failed for %d point(s) (ids=%s): %s",
                len(batch), ",".join(point_ids), exc,
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
    logger.info(f"Len of new rows {len(new_rows)}")
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
        campaign_id, created, skipped, failed, total,
    )
    return summary