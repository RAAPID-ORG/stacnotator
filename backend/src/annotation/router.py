import io
from typing import Optional
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from fastapi.security import HTTPBearer

from src.annotation.schema import (
    AnnotationCreate,
    AnnotationFromTaskCreate,
    AnnotationFromTaskOut,
    AnnotationOut,
    AnnotationTaskListOut,
    AnnotationUpdate,
    AISegmentationRequest,
    AISegmentationResponse,
)
from src.annotation import service
from src.auth.dependencies import require_approved_user, require_authenticated_user
from src.auth.models import User
from src.campaigns.dependancies import require_campaign_access, require_campaign_admin
from src.campaigns.models import Campaign
from src.database import get_db
from sqlalchemy.orm import Session

from src.utils import clean_filename, FunctionNameOperationIdRoute


bearer = HTTPBearer()  # Using only for adding bearer scheme to Swagger OpenAPI
router = APIRouter(
    tags=["Annotations"],
    dependencies=[Depends(bearer), Depends(require_approved_user)],
    route_class=FunctionNameOperationIdRoute,
)


@router.get("/campaigns/{campaign_id}/annotation-tasks", response_model=AnnotationTaskListOut)
def get_all_annotation_tasks(
    db=Depends(get_db), campaign: Campaign = Depends(require_campaign_access)
):
    tasks = campaign.task_items
    return AnnotationTaskListOut(campaign_id=campaign.id, tasks=tasks)


@router.post(
    "/campaigns/{campaign_id}/{annotation_task_id}/annotate",
    response_model=Optional[AnnotationFromTaskOut],
)
def complete_annotation_task(
    campaign_id: int,
    annotation_task_id: int,
    annotation: AnnotationFromTaskCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_authenticated_user),
    campaign: Campaign = Depends(require_campaign_access),
) -> None:
    # Validate task exists in campaign
    annotation_task = next(
        (task for task in campaign.task_items if task.id == annotation_task_id),
        None,
    )

    if annotation_task is None:
        raise HTTPException(
            status_code=404,
            detail="Annotation task not found in this campaign",
        )

    # Persist annotation
    annotation = service.add_annotation_for_task(
        db=db,
        annotation_task=annotation_task,
        annotation_create=annotation,
        user_id=user.id,
    )

    if annotation:
        return annotation


@router.post("/campaigns/{campaign_id}/create-annotation", response_model=AnnotationOut)
def create_annotation(
    campaign_id: int,
    annotation: AnnotationCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_authenticated_user),
    campaign: Campaign = Depends(require_campaign_access),
) -> None:
    annotation = service.create_annotation(
        db=db,
        campaign=campaign,
        annotation_create=annotation,
        user_id=user.id,
    )

    return annotation


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


@router.put(
    "/campaigns/{campaign_id}/annotations/{annotation_id}/update", response_model=AnnotationOut
)
def update_annotation(
    annotation_id: int,
    annotation_update: AnnotationUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_authenticated_user),
    campaign: Campaign = Depends(require_campaign_access),
) -> None:
    annotation = service.update_annotation(
        db=db,
        annotation_id=annotation_id,
        annotation_update=annotation_update,
        user_id=user.id,
    )

    return annotation


@router.delete("/campaigns/{campaign_id}/annotations/{annotation_id}", status_code=204)
def delete_annotation(
    campaign_id: int,
    annotation_id: int,
    db: Session = Depends(get_db),
    campaign: Campaign = Depends(require_campaign_access),
) -> None:
    """
    Delete a specific annotation from a campaign.

    If the annotation is linked to a task, the task status will be reset to pending.
    """
    service.delete_annotation(
        db=db,
        annotation_id=annotation_id,
        campaign_id=campaign.id,
    )


@router.get("/campaigns/{campaign_id}/export-annotations")
def export_annotations(
    db: Session = Depends(get_db), campaign: Campaign = Depends(require_campaign_access)
):
    annotations_df = service.build_annotations_export(db, campaign)
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


@router.post("/campaigns/{campaign_id}/ingest-annotation-task-csv")
async def ingest_annotation_task_from_csv(
    db: Session = Depends(get_db),
    campaign: Campaign = Depends(require_campaign_admin),
    file: UploadFile = File(...),
):
    if not file.filename.endswith(".csv"):
        raise HTTPException(status_code=400, detail="File must be a CSV")

    contents = await file.read()
    service.create_annotation_tasks_from_csv(db, campaign.id, contents)