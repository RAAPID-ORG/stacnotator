import io
import json
import logging

from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile
from fastapi.responses import StreamingResponse
from fastapi.security import HTTPBearer
from sqlalchemy.orm import Session

from src.annotation import embeddings_service, service
from src.annotation import io as annotation_io
from src.annotation.schemas import (
    AnnotationCreate,
    AnnotationDensityCell,
    AnnotationFromTaskCreate,
    AnnotationOut,
    AnnotationsExtentOut,
    AnnotationTaskListOut,
    AnnotationTaskOut,
    AnnotationTaskSubmitResponse,
    AnnotationUpdate,
    BatchCreateAnnotationsRequest,
    BatchCreateAnnotationsResponse,
    BatchDeleteAnnotationsRequest,
    BatchDeleteAnnotationsResponse,
    ClaimTaskResponse,
    KnnValidationStatusOut,
    ValidateLabelSubmissionsResponse,
)
from src.annotation.tiles import InvalidBBoxError, InvalidTileError, parse_bbox
from src.auth.dependencies import require_approved_user, require_authenticated_user
from src.auth.models import User
from src.campaigns.dependencies import require_campaign_access, require_campaign_admin
from src.campaigns.models import Campaign
from src.campaigns.task_sets import require_task_set
from src.database import get_db
from src.utils import FunctionNameOperationIdRoute, clean_filename

bearer = HTTPBearer()  # Using only for adding bearer scheme to Swagger OpenAPI
router = APIRouter(
    tags=["Annotations"],
    dependencies=[Depends(bearer), Depends(require_approved_user)],
    route_class=FunctionNameOperationIdRoute,
)

logger = logging.getLogger(__name__)


# ============================================================================
# Task-Based Annotation
# ============================================================================


@router.get("/campaigns/{campaign_id}/annotation-tasks", response_model=AnnotationTaskListOut)
def get_all_annotation_tasks(
    campaign_id: int,
    db: Session = Depends(get_db),
    campaign: Campaign = Depends(require_campaign_access),
):
    tasks = service.get_annotation_tasks_for_campaign(db, campaign_id)
    return AnnotationTaskListOut(campaign_id=campaign.id, tasks=tasks)


@router.post(
    "/campaigns/{campaign_id}/{annotation_task_id}/annotate",
    response_model=AnnotationTaskSubmitResponse,
)
def complete_annotation_task(
    campaign_id: int,
    annotation_task_id: int,
    annotation: AnnotationFromTaskCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_authenticated_user),
    campaign: Campaign = Depends(require_campaign_access),
) -> AnnotationTaskSubmitResponse:
    # Get the specific task efficiently
    annotation_task = service.get_annotation_task_by_id(
        db=db,
        task_id=annotation_task_id,
        campaign_id=campaign_id,
    )

    if annotation_task is None:
        raise HTTPException(
            status_code=404,
            detail="Annotation task not found in this campaign",
        )

    # Persist annotation
    result_annotation = service.add_annotation_for_task(
        db=db,
        annotation_task=annotation_task,
        annotation_create=annotation,
        user_id=user.id,
    )

    # Re-fetch the task with all relationships for accurate status computation
    refreshed_task = service.get_annotation_task_by_id(
        db=db,
        task_id=annotation_task_id,
        campaign_id=campaign_id,
    )

    task_out = AnnotationTaskOut.model_validate(refreshed_task)

    return AnnotationTaskSubmitResponse(
        annotation=result_annotation,
        task_status=task_out.task_status,
        assignment_status=service.get_user_assignment_status(refreshed_task, user.id),
    )


@router.post(
    "/campaigns/{campaign_id}/{annotation_task_id}/claim",
    response_model=ClaimTaskResponse,
)
def claim_annotation_task(
    campaign_id: int,
    annotation_task_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_authenticated_user),
    campaign: Campaign = Depends(require_campaign_access),
) -> ClaimTaskResponse:
    assignment = service.claim_task_for_user(
        db=db,
        campaign_id=campaign_id,
        task_id=annotation_task_id,
        user_id=user.id,
    )
    return ClaimTaskResponse(task_id=annotation_task_id, claimed_at=assignment.claimed_at)


@router.get(
    "/campaigns/{campaign_id}/annotations/{annotation_task_id}/validate-submission",
    response_model=ValidateLabelSubmissionsResponse,
)
def validate_annotation_submission(
    campaign_id: int,
    annotation_task_id: int,
    label_id: int,
    db: Session = Depends(get_db),
    campaign: Campaign = Depends(require_campaign_access),
):
    """Check whether a label_id agrees with the KNN-majority prediction
    derived from the task's satellite embedding and its nearest neighbours
    in the same campaign.

    Always returns 200 with a status field indicating the outcome:
    - ok - label matches neighbours
    - mismatch - label disagrees with neighbours
    - skipped_no_embedding - no embedding for the task
    - skipped_insufficient_data - not enough labeled data yet
    - disabled - no embedding year configured for this campaign
    """
    # Short-circuit if no embedding year is configured
    if not campaign.settings or campaign.settings.embedding_year is None:
        return ValidateLabelSubmissionsResponse(status="disabled", agrees=None)

    return embeddings_service.validate_label_submission(
        db,
        campaign_id=campaign_id,
        annotation_task_id=annotation_task_id,
        label_id=label_id,
    )


@router.get(
    "/campaigns/{campaign_id}/knn-validation-status",
    response_model=KnnValidationStatusOut,
)
def get_knn_validation_status(
    campaign_id: int,
    db: Session = Depends(get_db),
    campaign: Campaign = Depends(require_campaign_access),
):
    """Summarize how close the campaign is to having enough data for KNN
    label validation. Used by the annotator UI to explain why validation
    is unavailable on a given task/label.
    """
    embedding_year = campaign.settings.embedding_year if campaign.settings else None
    return embeddings_service.get_validation_status(
        db,
        campaign_id=campaign_id,
        embedding_year=embedding_year,
    )


@router.post("/campaigns/{campaign_id}/ingest-annotation-task-csv")
async def ingest_annotation_tasks_from_csv(
    db: Session = Depends(get_db),
    campaign: Campaign = Depends(require_campaign_admin),
    file: UploadFile = File(...),
    task_set_id: int = Form(...),
):
    if not file.filename.endswith(".csv"):
        raise HTTPException(status_code=400, detail="File must be a CSV")

    require_task_set(db, campaign.id, task_set_id, status_code=400)
    contents = await file.read()
    annotation_io.create_annotation_tasks_from_csv(db, campaign.id, contents, task_set_id)


@router.post("/campaigns/{campaign_id}/ingest-annotation-task-geojson")
async def ingest_annotation_tasks_from_geojson(
    db: Session = Depends(get_db),
    campaign: Campaign = Depends(require_campaign_admin),
    file: UploadFile = File(...),
    task_set_id: int = Form(...),
):
    """
    Ingest annotation tasks from a GeoJSON file.

    Each feature becomes one annotation task. Supported geometry types:
    Point, Polygon, MultiPolygon. Polygon geometries are stored as-is and
    displayed as the sample extent during annotation.
    """
    fname = (file.filename or "").lower()
    if not (fname.endswith(".geojson") or fname.endswith(".json")):
        raise HTTPException(status_code=400, detail="File must be a .geojson or .json file")

    require_task_set(db, campaign.id, task_set_id, status_code=400)
    contents = await file.read()
    num_created = annotation_io.create_annotation_tasks_from_geojson(
        db, campaign.id, contents, task_set_id
    )
    return {"num_tasks_created": num_created}


@router.post("/campaigns/{campaign_id}/ingest-annotations-geojson")
async def ingest_annotations_from_geojson(
    db: Session = Depends(get_db),
    campaign: Campaign = Depends(require_campaign_admin),
    user: User = Depends(require_authenticated_user),
    file: UploadFile = File(...),
):
    """
    Bulk-import existing features as standalone annotations (no task assignment).

    Each feature becomes one annotation owned by the uploading admin. The label
    is read from the ``stacnotator_label_id`` property and must be a label of
    the campaign; otherwise the whole import is rejected.
    """
    fname = (file.filename or "").lower()
    if not (fname.endswith(".geojson") or fname.endswith(".json")):
        raise HTTPException(status_code=400, detail="File must be a .geojson or .json file")

    contents = await file.read()
    num_created = annotation_io.create_annotations_from_geojson(db, campaign, contents, user.id)
    return {"num_annotations_created": num_created}


# ============================================================================
# Open-Mode Annotation
# ============================================================================


@router.post("/campaigns/{campaign_id}/create-annotation", response_model=AnnotationOut)
def create_annotation_openmode(
    campaign_id: int,
    annotation: AnnotationCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_authenticated_user),
    campaign: Campaign = Depends(require_campaign_access),
) -> AnnotationOut:
    annotation = service.create_annotation(
        db=db,
        campaign=campaign,
        annotation_create=annotation,
        user_id=user.id,
    )

    return annotation


@router.post(
    "/campaigns/{campaign_id}/annotations/batch-create",
    response_model=BatchCreateAnnotationsResponse,
)
def batch_create_annotations(
    campaign_id: int,
    req: BatchCreateAnnotationsRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_authenticated_user),
    campaign: Campaign = Depends(require_campaign_access),
) -> BatchCreateAnnotationsResponse:
    """
    Create many standalone annotations in one call (e.g. labelling many vector
    features at once), in a single transaction with one annotations-version bump.
    """
    created = service.create_annotations_bulk(
        db=db,
        campaign=campaign,
        annotations_create=req.annotations,
        user_id=user.id,
    )
    return BatchCreateAnnotationsResponse(created_count=created)


@router.put(
    "/campaigns/{campaign_id}/annotations/{annotation_id}/update", response_model=AnnotationOut
)
def update_annotation_openmode(
    annotation_id: int,
    annotation_update: AnnotationUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_authenticated_user),
    campaign: Campaign = Depends(require_campaign_access),
) -> AnnotationOut:
    annotation = service.update_annotation(
        db=db,
        annotation_id=annotation_id,
        annotation_update=annotation_update,
        user_id=user.id,
        campaign=campaign,
    )

    return annotation


# ============================================================================
# Common - for both modes
# ============================================================================


@router.delete(
    "/campaigns/{campaign_id}/annotations/{annotation_id}",
    response_model=AnnotationTaskSubmitResponse | None,
)
def delete_annotation(
    campaign_id: int,
    annotation_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_authenticated_user),
    campaign: Campaign = Depends(require_campaign_access),
):
    """
    Delete a specific annotation from a campaign.

    If the annotation is linked to a task, returns updated task_status and
    assignment_status. Otherwise returns null.
    """
    # Look up the annotation first to find its task_id before deleting
    task_id = service.get_annotation_task_id_for_annotation(db, annotation_id, campaign.id)

    service.delete_annotation(
        db=db,
        annotation_id=annotation_id,
        campaign_id=campaign.id,
        user_id=user.id,
        campaign=campaign,
    )

    # If it was linked to a task, return updated statuses
    if task_id is not None:
        refreshed_task = service.get_annotation_task_by_id(
            db=db,
            task_id=task_id,
            campaign_id=campaign_id,
        )
        if refreshed_task:
            task_out = AnnotationTaskOut.model_validate(refreshed_task)

            return AnnotationTaskSubmitResponse(
                annotation=None,
                task_status=task_out.task_status,
                assignment_status=service.get_user_assignment_status(refreshed_task, user.id),
            )

    return None


@router.post(
    "/campaigns/{campaign_id}/annotations/batch-delete",
    response_model=BatchDeleteAnnotationsResponse,
)
def batch_delete_annotations(
    campaign_id: int,
    req: BatchDeleteAnnotationsRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_authenticated_user),
    campaign: Campaign = Depends(require_campaign_access),
) -> BatchDeleteAnnotationsResponse:
    """
    Delete multiple annotations from a campaign in one call.

    Public campaigns: non-admins may only delete their own annotations.
    Task-linked annotations have their per-user assignment reset to 'pending'.
    """
    deleted = service.delete_annotations_bulk(
        db=db,
        annotation_ids=req.annotation_ids,
        campaign=campaign,
        user_id=user.id,
    )
    return BatchDeleteAnnotationsResponse(deleted_count=deleted)


@router.get("/campaigns/{campaign_id}/export-annotations")
def export_annotations(
    merge_on_agreement: bool = False,
    db: Session = Depends(get_db),
    campaign: Campaign = Depends(require_campaign_access),
):
    """Export campaign annotations as CSV.

    When ``merge_on_agreement`` is true, multi-annotator tasks whose
    annotators all agreed on the same label are collapsed into a single
    row. Tasks with disagreement (conflict) cause the request to fail
    with HTTP 400 - resolve the conflicts first.
    """
    annotations_df = annotation_io.build_annotations_export(
        db, campaign, merge_on_agreement=merge_on_agreement
    )
    campaign_name_cleaned = clean_filename(campaign.name)
    buffer = io.StringIO()
    annotations_df.to_csv(buffer, index=False)
    buffer.seek(0)
    return StreamingResponse(
        buffer,
        media_type="text/csv",
        headers={
            "Content-Disposition": (
                f'attachment; filename="campaign_{campaign_name_cleaned}_annotations.csv"'
            )
        },
    )


@router.get("/campaigns/{campaign_id}/export-annotations-geojson")
def export_annotations_geojson(
    merge_on_agreement: bool = False,
    db: Session = Depends(get_db),
    campaign: Campaign = Depends(require_campaign_access),
):
    """Export all annotations for a campaign as a GeoJSON FeatureCollection file.

    See ``export_annotations`` for the meaning of ``merge_on_agreement``.
    """
    geojson = annotation_io.build_annotations_geojson_export(
        db, campaign, merge_on_agreement=merge_on_agreement
    )
    campaign_name_cleaned = clean_filename(campaign.name)
    content = json.dumps(geojson)
    buffer = io.StringIO(content)

    return StreamingResponse(
        buffer,
        media_type="application/geo+json",
        headers={
            "Content-Disposition": (
                f'attachment; filename="campaign_{campaign_name_cleaned}_annotations.geojson"'
            )
        },
    )


@router.get("/campaigns/{campaign_id}/annotations", response_model=list[AnnotationOut])
def get_all_annotations_for_campaign(
    campaign_id: int,
    db: Session = Depends(get_db),
    campaign: Campaign = Depends(require_campaign_access),
):
    annotations = service.get_annotations_for_campaign(
        db=db,
        campaign_id=campaign.id,
    )
    return annotations


# ============================================================================
# Open-Mode Tiled View
#
# Serve open-mode annotations as vector tiles for the viewport instead of
# loading the whole campaign upfront. The literal-path routes below are
# declared before the `{annotation_id}` route so they are not shadowed by it.
# ============================================================================


@router.get("/campaigns/{campaign_id}/annotations/tiles/{z}/{x}/{y}.pbf")
def get_annotation_tile(
    campaign_id: int,
    z: int,
    x: int,
    y: int,
    db: Session = Depends(get_db),
    campaign: Campaign = Depends(require_campaign_access),
) -> Response:
    """Return one Mapbox Vector Tile of a campaign's annotations.

    Each feature carries only ``annotation_id`` and ``label_id``; the frontend
    styles by label and fetches full geometry by id when a feature is edited.
    """
    try:
        tile = service.render_annotation_tile(db, campaign.id, z, x, y)
    except InvalidTileError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return Response(
        content=tile,
        media_type="application/vnd.mapbox-vector-tile",
        headers={"Cache-Control": "private, max-age=3600"},
    )


@router.get("/campaigns/{campaign_id}/annotations/ids", response_model=list[int])
def get_annotation_ids_in_bbox(
    campaign_id: int,
    bbox: str,
    db: Session = Depends(get_db),
    campaign: Campaign = Depends(require_campaign_access),
) -> list[int]:
    """Return ids of annotations intersecting ``bbox`` (``minx,miny,maxx,maxy``
    in EPSG:4326). Backs box/multi-select against the tiled display."""
    try:
        minx, miny, maxx, maxy = parse_bbox(bbox)
    except InvalidBBoxError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return service.get_annotation_ids_in_bbox(db, campaign.id, minx, miny, maxx, maxy)


@router.get(
    "/campaigns/{campaign_id}/annotations/extent",
    response_model=AnnotationsExtentOut,
)
def get_annotations_extent(
    campaign_id: int,
    db: Session = Depends(get_db),
    campaign: Campaign = Depends(require_campaign_access),
) -> AnnotationsExtentOut:
    """Return the bounding box of a campaign's annotations for fit-to-bounds."""
    bbox = service.get_campaign_annotations_extent(db, campaign.id)
    return AnnotationsExtentOut(bbox=bbox)


@router.get(
    "/campaigns/{campaign_id}/annotations/density",
    response_model=list[AnnotationDensityCell],
)
def get_annotation_density(
    campaign_id: int,
    db: Session = Depends(get_db),
    campaign: Campaign = Depends(require_campaign_access),
) -> list[AnnotationDensityCell]:
    """Return a coarse grid of annotation counts for the minimap overview."""
    cells = service.get_annotation_density(db, campaign.id)
    return [AnnotationDensityCell(**cell) for cell in cells]


@router.get(
    "/campaigns/{campaign_id}/annotations/{annotation_id}",
    response_model=AnnotationOut,
)
def get_annotation(
    campaign_id: int,
    annotation_id: int,
    db: Session = Depends(get_db),
    campaign: Campaign = Depends(require_campaign_access),
) -> AnnotationOut:
    """Fetch one annotation's full-resolution geometry for click-to-edit."""
    annotation = service.get_annotation_by_id(db, annotation_id, campaign.id)
    if annotation is None:
        raise HTTPException(status_code=404, detail="Annotation not found in this campaign")
    return annotation
