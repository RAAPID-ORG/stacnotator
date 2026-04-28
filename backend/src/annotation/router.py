import io
import json
import logging

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from fastapi.security import HTTPBearer
from sqlalchemy.orm import Session

from src.annotation import embeddings_service, service
from src.annotation.schemas import (
    AnnotationCreate,
    AnnotationFromTaskCreate,
    AnnotationOut,
    AnnotationTaskListOut,
    AnnotationTaskOut,
    AnnotationTaskSubmitResponse,
    AnnotationUpdate,
    BatchDeleteAnnotationsRequest,
    BatchDeleteAnnotationsResponse,
    KnnValidationStatusOut,
    ValidateLabelSubmissionsResponse,
)
from src.auth.dependencies import require_approved_user, require_authenticated_user
from src.auth.models import User
from src.campaigns.dependencies import require_campaign_access, require_campaign_admin
from src.campaigns.models import Campaign
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
):
    if not file.filename.endswith(".csv"):
        raise HTTPException(status_code=400, detail="File must be a CSV")

    contents = await file.read()
    service.create_annotation_tasks_from_csv(db, campaign.id, contents)


@router.post("/campaigns/{campaign_id}/ingest-annotation-task-geojson")
async def ingest_annotation_tasks_from_geojson(
    db: Session = Depends(get_db),
    campaign: Campaign = Depends(require_campaign_admin),
    file: UploadFile = File(...),
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

    contents = await file.read()
    num_created = service.create_annotation_tasks_from_geojson(db, campaign.id, contents)
    return {"num_tasks_created": num_created}


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
    annotations_df = service.build_annotations_export(
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
    geojson = service.build_annotations_geojson_export(
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
