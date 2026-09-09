"""The job runner's liveness and failure handling (src/area_estimation/jobs.py),
without touching a raster: the work itself is stubbed."""

from datetime import timedelta

import pytest

from src.area_estimation import jobs
from src.area_estimation.raster import MapError
from src.area_estimation.schemas import (
    BandInfo,
    Bbox,
    JobRecord,
    MapInfo,
    MapRecord,
    SourceInfo,
    SourceRef,
)
from src.area_estimation.workspace import LocalWorkspace, new_id

CAMPAIGN = 3


def _info() -> MapInfo:
    band = BandInfo(index=1, dtype="uint8", description=None, nodata=None)
    bbox = Bbox(west=0, south=0, east=1, north=1)
    source = SourceInfo(
        name="m.tif",
        width=10,
        height=10,
        crs="EPSG:6933",
        crs_name="x",
        is_geographic=False,
        is_equal_area=True,
        resolution=(10, 10),
        pixel_area_m2=100,
        bbox=bbox,
        bands=[band],
    )
    return MapInfo(
        sources=[source],
        bands=[band],
        bbox=bbox,
        total_pixels=100,
        is_equal_area=True,
        proposed_crs="EPSG:6933",
    )


@pytest.fixture()
def workspace(tmp_path):
    return LocalWorkspace(tmp_path)


@pytest.fixture()
def record(workspace):
    map_id = new_id()
    record = MapRecord(
        id=map_id,
        campaign_id=CAMPAIGN,
        created_at=jobs.now(),
        sources=[SourceRef(kind="upload", name="m.tif", location="00-m.tif")],
        info=_info(),
    )
    workspace.write_map(record)
    return record


def _job(record, heartbeat=None) -> JobRecord:
    at = heartbeat or jobs.now()
    return JobRecord(
        id="a" * 32,
        campaign_id=CAMPAIGN,
        map_id=record.id,
        kind="preprocess",
        spec={"crs": "EPSG:6933"},
        status="running",
        created_at=at,
        heartbeat_at=at,
    )


class TestStaleness:
    def test_a_fresh_running_job_is_not_stale(self, record):
        assert not jobs.is_stale(_job(record))

    def test_a_finished_job_is_never_stale(self, record):
        job = _job(record, jobs.now() - timedelta(days=1))
        job.status = "done"
        assert not jobs.is_stale(job)

    def test_sweep_fails_the_job_and_releases_the_map(self, workspace, record):
        job = _job(record, jobs.now() - timedelta(seconds=jobs.STALE_AFTER_SECONDS + 1))
        workspace.write_job(job)
        record.active_job_id = job.id
        workspace.write_map(record)

        swept = jobs.sweep_if_stale(workspace, job)

        assert swept.status == "failed"
        assert swept.error == jobs.INTERRUPTED_ERROR
        assert workspace.read_job(CAMPAIGN, job.id).status == "failed"
        assert workspace.read_map(CAMPAIGN, record.id).active_job_id is None

    def test_sweep_leaves_another_jobs_map_alone(self, workspace, record):
        job = _job(record, jobs.now() - timedelta(seconds=jobs.STALE_AFTER_SECONDS + 1))
        workspace.write_job(job)
        record.active_job_id = "b" * 32
        workspace.write_map(record)
        jobs.sweep_if_stale(workspace, job)
        assert workspace.read_map(CAMPAIGN, record.id).active_job_id == "b" * 32


class TestExecute:
    def _run(self, workspace, record, work, monkeypatch):
        monkeypatch.setattr(jobs, "_run", work)
        job = _job(record)
        job.status = "queued"
        record.active_job_id = job.id
        workspace.write_map(record)
        jobs.execute(workspace, job, max_grid_pixels=10)
        return job, workspace.read_job(CAMPAIGN, job.id)

    def test_map_error_becomes_the_users_message(self, workspace, record, monkeypatch):
        def work(*args):
            raise MapError("tiles disagree")

        job, stored = self._run(workspace, record, work, monkeypatch)
        assert stored.status == "failed"
        assert stored.error == "tiles disagree"
        assert stored.finished_at is not None
        assert workspace.read_map(CAMPAIGN, record.id).active_job_id is None

    def test_unexpected_error_is_not_leaked(self, workspace, record, monkeypatch):
        def work(*args):
            raise RuntimeError("/secret/path exploded")

        _, stored = self._run(workspace, record, work, monkeypatch)
        assert stored.status == "failed"
        assert "/secret/path" not in stored.error

    def test_missing_map_fails_cleanly(self, workspace, record, monkeypatch):
        workspace.delete_map(CAMPAIGN, record.id)
        job = _job(record)
        jobs.execute(workspace, job, max_grid_pixels=10)
        assert workspace.read_job(CAMPAIGN, job.id).status == "failed"
        assert "no longer in the workspace" in job.error

    def test_progress_is_written_with_a_fresh_heartbeat(self, workspace, record, monkeypatch):
        seen = []

        def work(workspace_, record_, job, max_pixels, progress):
            progress(0.5)
            seen.append(workspace.read_job(CAMPAIGN, job.id).progress)
            progress(1.0)
            return record_.info and None

        job, stored = self._run(workspace, record, work, monkeypatch)
        assert seen == [0.5]
        assert stored.progress == 1.0
        assert stored.status == "done"
        assert stored.heartbeat_at >= stored.created_at


class TestLocalRunner:
    def test_runs_the_job_on_a_thread_and_records_the_outcome(self, workspace, record, monkeypatch):
        import threading

        done = threading.Event()

        def work(*args):
            done.set()
            raise MapError("stop here")

        monkeypatch.setattr(jobs, "_run", work)
        job = _job(record)
        jobs.LocalRunner(workspace, max_concurrent=1, max_grid_pixels=10).submit(job)
        assert done.wait(5)
        for _ in range(50):
            stored = workspace.read_job(CAMPAIGN, job.id)
            if stored is not None and stored.status == "failed":
                break
            threading.Event().wait(0.05)
        assert stored.error == "stop here"
