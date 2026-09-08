from fastapi import APIRouter, Depends, File, HTTPException, Request, Response, UploadFile
from fastapi.security import HTTPBearer
from starlette.concurrency import run_in_threadpool

from src.area_estimation import service
from src.area_estimation.schemas import (
    JobOut,
    LinkMapRequest,
    MapOut,
    PreprocessRequest,
    StratifyRequest,
)
from src.auth.dependencies import require_authenticated_user
from src.campaigns.dependencies import require_campaign_admin
from src.campaigns.models import Campaign
from src.config import get_settings

bearer = HTTPBearer()
router = APIRouter(
    prefix="/campaigns/{campaign_id}/area-estimation",
    tags=["Area Estimation"],
    dependencies=[Depends(bearer), Depends(require_authenticated_user)],
)


def _reject_oversized(request: Request) -> None:
    """Refuse a body the limit would reject anyway before it is spooled to disk."""
    declared = request.headers.get("content-length")
    if declared and int(declared) > get_settings().AREA_ESTIMATION_MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Upload exceeds the size limit")


@router.post("/maps", response_model=MapOut, status_code=201)
async def upload_map(
    request: Request,
    files: list[UploadFile] = File(..., description="The map as one or more GeoTIFF tiles"),
    campaign: Campaign = Depends(require_campaign_admin),
):
    """Store a classified map on the worker for the duration of the sampling design.

    Several files are the tiles of one map: they must share their bands and may
    overlap only where they agree. The response carries what each file's header
    says about it and the equal-area projection proposed for counting.
    """
    _reject_oversized(request)
    uploads = [(upload.filename or "", upload.file) for upload in files]
    return await run_in_threadpool(service.create_map_from_uploads, campaign.id, uploads)


@router.post("/maps/link", response_model=MapOut, status_code=201)
async def link_map(body: LinkMapRequest, campaign: Campaign = Depends(require_campaign_admin)):
    """Register a map hosted elsewhere. Nothing is copied: every job reads the
    URLs directly, so they should be cloud-optimized GeoTIFFs."""
    return await run_in_threadpool(service.create_map_from_urls, campaign.id, body.urls)


@router.get("/maps", response_model=list[MapOut])
def list_maps(campaign: Campaign = Depends(require_campaign_admin)):
    return service.list_maps(campaign.id)


@router.get("/maps/{map_id}", response_model=MapOut)
def get_map(map_id: str, campaign: Campaign = Depends(require_campaign_admin)):
    return service.get_map(campaign.id, map_id)


@router.delete("/maps/{map_id}", status_code=204, response_class=Response)
def delete_map(map_id: str, campaign: Campaign = Depends(require_campaign_admin)):
    service.delete_map(campaign.id, map_id)


@router.put("/maps/{map_id}/areas", response_model=MapOut)
async def set_areas(
    request: Request,
    map_id: str,
    file: UploadFile = File(..., description="GeoJSON, or a zipped shapefile"),
    campaign: Campaign = Depends(require_campaign_admin),
):
    """Attach areas of interest: one named area per feature, none overlapping.
    Replaces the previous set and clears any census counted over it."""
    _reject_oversized(request)
    return await run_in_threadpool(
        service.set_areas, campaign.id, map_id, file.filename or "", file.file
    )


@router.delete("/maps/{map_id}/areas", response_model=MapOut)
def clear_areas(map_id: str, campaign: Campaign = Depends(require_campaign_admin)):
    return service.clear_areas(campaign.id, map_id)


@router.post("/maps/{map_id}/preprocess", response_model=JobOut, status_code=202)
def preprocess(
    map_id: str, body: PreprocessRequest, campaign: Campaign = Depends(require_campaign_admin)
):
    """Reproject the map onto an equal-area grid with nearest resampling and
    count its pixels per value, per area of interest. Runs in the background;
    poll the job for the census."""
    return service.start_preprocess(campaign.id, map_id, body)


@router.post("/maps/{map_id}/stratify", response_model=JobOut, status_code=202)
def stratify(
    map_id: str, body: StratifyRequest, campaign: Campaign = Depends(require_campaign_admin)
):
    """Fold map values into reporting classes, writing the strata raster a
    sample is later drawn from. Every value the census saw must be assigned."""
    return service.start_stratify(campaign.id, map_id, body)


@router.get("/jobs/{job_id}", response_model=JobOut)
def get_job(job_id: str, campaign: Campaign = Depends(require_campaign_admin)):
    return service.get_job(campaign.id, job_id)
