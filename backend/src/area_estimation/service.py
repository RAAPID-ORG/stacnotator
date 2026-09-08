"""Orchestration between the API and the worker holding the map: creating maps
from uploads or links, attaching areas of interest, starting jobs and reading
them back. HTTP errors are raised here so the router stays thin."""

import json
import re
from functools import lru_cache
from pathlib import Path
from tempfile import gettempdir
from typing import BinaryIO
from urllib.parse import urlparse

import httpx
from fastapi import HTTPException

from src.area_estimation import jobs, raster
from src.area_estimation.areas import read_areas
from src.area_estimation.azure_jobs import AzureJobRunner, ManagedIdentity
from src.area_estimation.raster import MapError
from src.area_estimation.schemas import (
    MAX_SOURCES_PER_MAP,
    AreaSet,
    JobRecord,
    MapRecord,
    PreprocessRequest,
    SourceRef,
    StratifyRequest,
)
from src.area_estimation.workspace import AREAS_FILE, UploadTooLarge, Workspace, is_id, new_id
from src.config import get_settings
from src.net_guard import UnsafeUrlError, assert_public_url

RASTER_SUFFIXES = (".tif", ".tiff")
SAFE_NAME = re.compile(r"[^A-Za-z0-9._-]")


@lru_cache
def workspace() -> Workspace:
    root = get_settings().AREA_ESTIMATION_WORKDIR or str(
        Path(gettempdir()) / "stacnotator-area-estimation"
    )
    path = Path(root)
    path.mkdir(parents=True, exist_ok=True)
    return Workspace(path)


@lru_cache
def runner() -> jobs.Runner:
    settings = get_settings()
    if settings.AREA_ESTIMATION_RUNNER == "azure":
        client = httpx.Client(timeout=30)
        return AzureJobRunner(
            workspace(),
            settings.AREA_ESTIMATION_AZURE_JOB_ID or "",
            ManagedIdentity(client, settings.AREA_ESTIMATION_AZURE_CLIENT_ID),
            client,
        )
    return jobs.LocalRunner(
        workspace(),
        settings.AREA_ESTIMATION_MAX_CONCURRENT_JOBS,
        settings.AREA_ESTIMATION_MAX_GRID_PIXELS,
    )


def _bad_request(exc: Exception) -> HTTPException:
    return HTTPException(status_code=400, detail=str(exc))


# ============================================================================
# Maps
# ============================================================================


def _safe_file_name(index: int, name: str) -> str:
    base = SAFE_NAME.sub("_", Path(name).name)[:100] or "tile.tif"
    return f"{index:02d}-{base}"


def _finish_map(campaign_id: int, map_id: str, refs: list[SourceRef]) -> MapRecord:
    space = workspace()
    try:
        info = raster.inspect_map(jobs.sources_of(refs, space.map_dir(campaign_id, map_id)))
    except MapError as exc:
        space.delete_map(campaign_id, map_id)
        raise _bad_request(exc) from exc
    record = MapRecord(
        id=map_id, campaign_id=campaign_id, created_at=jobs.now(), sources=refs, info=info
    )
    space.write_map(record)
    return record


def create_map_from_uploads(campaign_id: int, uploads: list[tuple[str, BinaryIO]]) -> MapRecord:
    if not uploads:
        raise HTTPException(status_code=400, detail="Upload at least one GeoTIFF")
    if len(uploads) > MAX_SOURCES_PER_MAP:
        raise HTTPException(
            status_code=400, detail=f"At most {MAX_SOURCES_PER_MAP} tiles make up one map"
        )
    for name, _ in uploads:
        if not name.lower().endswith(RASTER_SUFFIXES):
            raise HTTPException(status_code=400, detail=f"{name} is not a GeoTIFF (.tif)")

    space = workspace()
    map_id, map_dir = space.create_map_dir(campaign_id)
    limit = get_settings().AREA_ESTIMATION_MAX_UPLOAD_BYTES
    refs = []
    try:
        for index, (name, stream) in enumerate(uploads):
            stored = _safe_file_name(index, name)
            space.save_stream(map_dir / "sources" / stored, stream, limit)
            refs.append(SourceRef(kind="upload", name=Path(name).name, location=stored))
    except UploadTooLarge as exc:
        space.delete_map(campaign_id, map_id)
        raise HTTPException(status_code=413, detail=str(exc)) from exc
    return _finish_map(campaign_id, map_id, refs)


def create_map_from_urls(campaign_id: int, urls: list[str]) -> MapRecord:
    refs = []
    for url in urls:
        url = url.strip()
        if urlparse(url).scheme not in ("http", "https"):
            raise HTTPException(status_code=400, detail=f"Not an http(s) URL: {url}")
        try:
            assert_public_url(url)
        except UnsafeUrlError as exc:
            raise _bad_request(exc) from exc
        refs.append(SourceRef(kind="url", name=Path(urlparse(url).path).name or url, location=url))
    space = workspace()
    map_id, _ = space.create_map_dir(campaign_id)
    return _finish_map(campaign_id, map_id, refs)


def get_map(campaign_id: int, map_id: str) -> MapRecord:
    record = workspace().read_map(campaign_id, map_id) if is_id(map_id) else None
    if record is None:
        raise HTTPException(status_code=404, detail="Map not found on this worker")
    return _with_stale_job_released(record)


def _with_stale_job_released(record: MapRecord) -> MapRecord:
    if record.active_job_id is None:
        return record
    job = workspace().read_job(record.campaign_id, record.active_job_id)
    if job is None:
        record.active_job_id = None
        workspace().write_map(record)
        return record
    jobs.sweep_if_stale(workspace(), job)
    return workspace().read_map(record.campaign_id, record.id) or record


def list_maps(campaign_id: int) -> list[MapRecord]:
    return [_with_stale_job_released(record) for record in workspace().list_maps(campaign_id)]


def _require_idle(record: MapRecord) -> None:
    if record.active_job_id is not None:
        raise HTTPException(
            status_code=409, detail="The map is being processed; wait for the job to finish"
        )


def delete_map(campaign_id: int, map_id: str) -> None:
    _require_idle(get_map(campaign_id, map_id))
    workspace().delete_map(campaign_id, map_id)


# ============================================================================
# Areas of interest
# ============================================================================


def set_areas(campaign_id: int, map_id: str, file_name: str, stream: BinaryIO) -> MapRecord:
    record = get_map(campaign_id, map_id)
    _require_idle(record)
    space = workspace()
    map_dir = space.map_dir(campaign_id, map_id)
    upload = map_dir / f"areas-upload{Path(file_name).suffix.lower()}"
    try:
        space.save_stream(upload, stream, get_settings().AREA_ESTIMATION_MAX_UPLOAD_BYTES)
        areas, collection = read_areas(upload, file_name)
    except UploadTooLarge as exc:
        raise HTTPException(status_code=413, detail=str(exc)) from exc
    except MapError as exc:
        raise _bad_request(exc) from exc
    finally:
        upload.unlink(missing_ok=True)
    (map_dir / AREAS_FILE).write_text(json.dumps(collection))
    record.areas = AreaSet(file_name=Path(file_name).name, areas=areas)
    # Counts were taken over the previous areas, or none.
    record.preprocess = None
    record.strata = None
    space.write_map(record)
    return record


def clear_areas(campaign_id: int, map_id: str) -> MapRecord:
    record = get_map(campaign_id, map_id)
    _require_idle(record)
    (workspace().map_dir(campaign_id, map_id) / AREAS_FILE).unlink(missing_ok=True)
    record.areas = None
    record.preprocess = None
    record.strata = None
    workspace().write_map(record)
    return record


# ============================================================================
# Jobs
# ============================================================================


def _start(record: MapRecord, kind, spec: PreprocessRequest | StratifyRequest) -> JobRecord:
    _require_idle(record)
    started = jobs.now()
    job = JobRecord(
        id=new_id(),
        campaign_id=record.campaign_id,
        map_id=record.id,
        kind=kind,
        spec=spec,
        status="queued",
        created_at=started,
        heartbeat_at=started,
    )
    space = workspace()
    space.write_job(job)
    record.active_job_id = job.id
    space.write_map(record)
    runner().submit(job)
    return job


def start_preprocess(campaign_id: int, map_id: str, spec: PreprocessRequest) -> JobRecord:
    record = get_map(campaign_id, map_id)
    if spec.band > len(record.info.bands):
        raise HTTPException(status_code=400, detail=f"The map has {len(record.info.bands)} band(s)")
    try:
        raster.equal_area_crs(spec.crs)
    except MapError as exc:
        raise _bad_request(exc) from exc
    return _start(record, "preprocess", spec)


def start_stratify(campaign_id: int, map_id: str, spec: StratifyRequest) -> JobRecord:
    record = get_map(campaign_id, map_id)
    if record.preprocess is None:
        raise HTTPException(status_code=400, detail="Preprocess the map before defining strata")
    assigned = {v for cls in spec.classes for v in cls.values} | set(spec.nodata_values)
    unassigned = sorted(set(record.preprocess.census.total) - assigned)
    if unassigned:
        raise HTTPException(
            status_code=400,
            detail="Map values without a class or a nodata declaration: "
            + ", ".join(str(v) for v in unassigned[:20]),
        )
    return _start(record, "stratify", spec)


def get_job(campaign_id: int, job_id: str) -> JobRecord:
    job = workspace().read_job(campaign_id, job_id) if is_id(job_id) else None
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return jobs.sweep_if_stale(workspace(), job)
