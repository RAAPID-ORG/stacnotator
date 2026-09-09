"""Running a preprocessing job, and the seam between asking for one and doing it.

``execute`` does the work: it needs a workspace holding the map and nothing
else, so it runs the same in this process, in a worker spun up for one job, or
on a developer's machine. A ``Runner`` decides where. The one here starts a
daemon thread; ``azure_jobs.AzureJobRunner`` hands the same job record to a
Container Apps Job execution, and no caller can tell the difference because
both leave the same job record behind.

Liveness follows src/background.py: a running job stamps a heartbeat, and a
job whose heartbeat stops belongs to a process that died. The record is judged
stale by the absence of writes, so recovery needs nothing from the dead
process.
"""

import json
import logging
import threading
import time
from datetime import UTC, datetime, timedelta
from typing import Protocol

from src.area_estimation import raster
from src.area_estimation.areas import zones_on_grid
from src.area_estimation.raster import MapError, Source, Zone
from src.area_estimation.schemas import (
    JobRecord,
    MapRecord,
    PreprocessProduct,
    PreprocessRequest,
    RawCensus,
    SourceRef,
    StrataCensus,
    StrataProduct,
    StratifyRequest,
)
from src.area_estimation.workspace import (
    AREAS_FILE,
    REPROJECTED_FILE,
    SOURCES_DIR,
    STRATA_FILE,
    Workspace,
)

logger = logging.getLogger(__name__)

HEARTBEAT_SECONDS = 15.0
PROGRESS_WRITE_SECONDS = 2.0
STALE_AFTER_SECONDS = 120.0
# A queued job has no heartbeat yet: a worker spun up for it may still be
# pulling its image. Patience here costs a user only a longer wait on a job
# that never starts.
QUEUED_STALE_AFTER_SECONDS = 600.0
INTERRUPTED_ERROR = "Processing was interrupted; run it again"


def now() -> datetime:
    return datetime.now(UTC)


class Runner(Protocol):
    def submit(self, job: JobRecord) -> None: ...


class LocalRunner:
    """Runs jobs on daemon threads of this process."""

    def __init__(self, workspace: Workspace, max_concurrent: int, max_grid_pixels: int):
        self._workspace = workspace
        self._max_grid_pixels = max_grid_pixels
        self._slots = threading.Semaphore(max_concurrent)

    def submit(self, job: JobRecord) -> None:
        def _run() -> None:
            with self._slots:
                execute(self._workspace, job, self._max_grid_pixels)

        threading.Thread(target=_run, daemon=True, name=f"area-estimation-{job.id}").start()


def is_stale(job: JobRecord, at: datetime | None = None) -> bool:
    if job.status not in ("queued", "running"):
        return False
    limit = QUEUED_STALE_AFTER_SECONDS if job.status == "queued" else STALE_AFTER_SECONDS
    return (at or now()) - job.heartbeat_at > timedelta(seconds=limit)


def sweep_if_stale(workspace: Workspace, job: JobRecord) -> JobRecord:
    """Flip a job whose worker died to failed, releasing its map."""
    if not is_stale(job):
        return job
    job.status = "failed"
    job.error = INTERRUPTED_ERROR
    job.finished_at = now()
    workspace.write_job(job)
    release_map(workspace, job)
    return job


def release_map(workspace: Workspace, job: JobRecord) -> None:
    record = workspace.read_map(job.campaign_id, job.map_id)
    if record is not None and record.active_job_id == job.id:
        record.active_job_id = None
        workspace.write_map(record)


class _JobWriter:
    """Serialises every write of one job record, from the worker thread and the
    heartbeat thread alike, and throttles the progress ones."""

    def __init__(self, workspace: Workspace, job: JobRecord):
        self._workspace = workspace
        self._job = job
        self._lock = threading.Lock()
        self._last_progress = 0.0

    def write(self) -> None:
        with self._lock:
            self._job.heartbeat_at = now()
            self._workspace.write_job(self._job)

    def progress(self, fraction: float) -> None:
        self._job.progress = fraction
        if time.monotonic() - self._last_progress >= PROGRESS_WRITE_SECONDS or fraction >= 1.0:
            self._last_progress = time.monotonic()
            self.write()


def execute(workspace: Workspace, job: JobRecord, max_grid_pixels: int) -> None:
    """Run one job to completion and leave its outcome in the workspace."""
    writer = _JobWriter(workspace, job)
    job.status = "running"
    writer.write()
    stop = threading.Event()

    def _beat() -> None:
        while not stop.wait(HEARTBEAT_SECONDS):
            writer.write()

    beat = threading.Thread(target=_beat, daemon=True, name=f"heartbeat-{job.id}")
    beat.start()
    try:
        record = workspace.read_map(job.campaign_id, job.map_id)
        if record is None:
            raise MapError("The map is no longer in the workspace; upload it again")
        job.result = _run(workspace, record, job, max_grid_pixels, writer.progress)
        job.status = "done"
        logger.info("Area estimation %s job %s done", job.kind, job.id)
    except MapError as exc:
        job.status = "failed"
        job.error = str(exc)
        logger.warning("Area estimation %s job %s failed: %s", job.kind, job.id, exc)
    except Exception:
        job.status = "failed"
        job.error = "Processing failed unexpectedly; the log has the details"
        logger.exception("Area estimation %s job %s crashed", job.kind, job.id)
    finally:
        stop.set()
        beat.join(timeout=5)
        job.finished_at = now()
        writer.write()
        release_map(workspace, job)


def _run(
    workspace: Workspace,
    record: MapRecord,
    job: JobRecord,
    max_grid_pixels: int,
    progress: raster.Progress,
) -> RawCensus | StrataCensus:
    if isinstance(job.spec, PreprocessRequest):
        census = _preprocess(workspace, record, job.spec, max_grid_pixels, progress)
        record.preprocess = PreprocessProduct(spec=job.spec, census=census, path=REPROJECTED_FILE)
        # Strata were folded from the previous grid; they no longer describe this one.
        record.strata = None
        workspace.write_map(record)
        return census
    if record.preprocess is None:
        raise MapError("The map has not been preprocessed yet")
    strata = _stratify(workspace, record, job.spec, progress)
    record.strata = StrataProduct(spec=job.spec, census=strata, path=STRATA_FILE)
    workspace.write_map(record)
    return strata


def sources_of(
    refs: list[SourceRef], workspace: Workspace, campaign_id: int, map_id: str
) -> list[Source]:
    return [
        Source(
            name=ref.name,
            location=workspace.location(campaign_id, map_id, f"{SOURCES_DIR}/{ref.location}")
            if ref.kind == "upload"
            else ref.location,
        )
        for ref in refs
    ]


def _zones(workspace: Workspace, record: MapRecord, grid_crs: str) -> list[Zone]:
    text = workspace.read_text(record.campaign_id, record.id, AREAS_FILE)
    return zones_on_grid(json.loads(text), grid_crs) if text else []


def _preprocess(
    workspace: Workspace,
    record: MapRecord,
    spec: PreprocessRequest,
    max_grid_pixels: int,
    progress: raster.Progress,
) -> RawCensus:
    options = workspace.gdal_options()
    sources = sources_of(record.sources, workspace, record.campaign_id, record.id)
    grid = raster.plan_grid(sources, spec.crs, spec.resolution_m, max_grid_pixels, options)
    out = workspace.scratch_dir(record.campaign_id, record.id) / REPROJECTED_FILE
    census = raster.reproject(
        sources, spec.band, grid, _zones(workspace, record, grid.crs), str(out), progress, options
    )
    workspace.store_product(record.campaign_id, record.id, REPROJECTED_FILE, out)
    return census


def _stratify(
    workspace: Workspace, record: MapRecord, spec: StratifyRequest, progress: raster.Progress
) -> StrataCensus:
    product = record.preprocess
    assert product is not None  # noqa: S101 - checked by the caller
    grid = product.census.grid
    out = workspace.scratch_dir(record.campaign_id, record.id) / STRATA_FILE
    census = raster.stratify(
        workspace.location(record.campaign_id, record.id, product.path),
        spec.classes,
        spec.nodata_values,
        grid,
        _zones(workspace, record, grid.crs),
        str(out),
        progress,
        workspace.gdal_options(),
    )
    _check_against_raw(product.census, spec, census)
    workspace.store_product(record.campaign_id, record.id, STRATA_FILE, out)
    return census


def _check_against_raw(raw: RawCensus, spec: StratifyRequest, census: StrataCensus) -> None:
    """The strata raster is counted on its own, independently of the raw census;
    the two must agree exactly or something in the pipeline is wrong."""
    expected = {
        area_id: {cls.id: sum(counts.get(v, 0) for v in cls.values) for cls in spec.classes}
        for area_id, counts in {"": raw.total, **raw.by_area}.items()
    }
    actual = {"": census.total, **census.by_area}
    if actual != expected:
        raise MapError("Strata counts disagree with the map census; preprocessing is inconsistent")
