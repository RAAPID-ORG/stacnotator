"""The Azure runner and the worker entrypoint, against a mocked management API."""

import json
from datetime import timedelta
from types import SimpleNamespace

import httpx
import pytest

from src.area_estimation import azure_jobs, blob, jobs, worker
from src.area_estimation.azure_jobs import AzureJobRunner
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

CAMPAIGN = 5
JOB_ID = "/subscriptions/s/resourceGroups/rg/providers/Microsoft.App/jobs/ae-worker"
JOB_DEFINITION = {
    "properties": {
        "template": {
            "containers": [
                {
                    "name": "worker",
                    "image": "acr.io/backend:1",
                    "command": ["python", "-m", "src.area_estimation.worker"],
                    "resources": {"cpu": 2, "memory": "4Gi"},
                    "env": [{"name": "AREA_ESTIMATION_BLOB_CONTAINER_URL", "value": "https://a/c"}],
                    "probes": [],
                }
            ]
        }
    }
}


class _Credential:
    def __init__(self):
        self.scopes: list[str] = []

    def get_token(self, *scopes, **kwargs):
        self.scopes.extend(scopes)
        return SimpleNamespace(token="tok", expires_on=9999999999)


def _info() -> MapInfo:
    band = BandInfo(index=1, dtype="uint8", description=None, nodata=None)
    bbox = Bbox(west=0, south=0, east=1, north=1)
    source = SourceInfo(
        name="m.tif",
        width=1,
        height=1,
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
        total_pixels=1,
        is_equal_area=True,
        proposed_crs="EPSG:6933",
    )


@pytest.fixture()
def workspace(tmp_path):
    return LocalWorkspace(tmp_path)


@pytest.fixture()
def job(workspace):
    map_id = new_id()
    record = MapRecord(
        id=map_id,
        campaign_id=CAMPAIGN,
        created_at=jobs.now(),
        sources=[SourceRef(kind="upload", name="m.tif", location="00-m.tif")],
        info=_info(),
        active_job_id="c" * 32,
    )
    workspace.write_map(record)
    job = JobRecord(
        id="c" * 32,
        campaign_id=CAMPAIGN,
        map_id=map_id,
        kind="preprocess",
        spec={"crs": "EPSG:6933"},
        status="queued",
        created_at=jobs.now(),
        heartbeat_at=jobs.now(),
    )
    workspace.write_job(job)
    return job


class _Api:
    """Records every call the runner makes and answers like Azure would."""

    def __init__(self, start_status: int = 202):
        self.calls: list[httpx.Request] = []
        self.start_status = start_status

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.calls.append(request)
        if request.url.path.endswith("/start"):
            return httpx.Response(self.start_status, json={"name": "ae-worker-abc"})
        return httpx.Response(200, json=JOB_DEFINITION)


def _runner(workspace, api: _Api) -> tuple[AzureJobRunner, _Credential]:
    cred = _Credential()
    client = httpx.Client(transport=httpx.MockTransport(api))
    return AzureJobRunner(workspace, JOB_ID, cred, client), cred


class TestAzureJobRunner:
    def test_starts_an_execution_carrying_the_job_reference(self, workspace, job):
        api = _Api()
        runner, cred = _runner(workspace, api)
        runner.submit(job)

        assert cred.scopes == [azure_jobs.MANAGEMENT_SCOPE]
        definition, start = api.calls
        assert definition.method == "GET"
        assert definition.headers["Authorization"] == "Bearer tok"
        assert start.url.path == f"{JOB_ID}/start"
        assert start.url.params["api-version"] == azure_jobs.API_VERSION
        [container] = json.loads(start.content)["containers"]
        assert container["name"] == "worker"
        assert container["image"] == "acr.io/backend:1"
        assert container["command"] == ["python", "-m", "src.area_estimation.worker"]
        assert "probes" not in container
        assert container["env"] == [
            {"name": "AREA_ESTIMATION_BLOB_CONTAINER_URL", "value": "https://a/c"},
            {"name": worker.JOB_ENV, "value": f"{CAMPAIGN}/{job.id}"},
        ]
        assert workspace.read_job(CAMPAIGN, job.id).status == "queued"

    def test_a_start_that_fails_fails_the_job_and_releases_the_map(self, workspace, job):
        runner, _ = _runner(workspace, _Api(start_status=403))
        runner.submit(job)

        stored = workspace.read_job(CAMPAIGN, job.id)
        assert stored.status == "failed"
        assert stored.error == azure_jobs.START_FAILED_ERROR
        assert workspace.read_map(CAMPAIGN, job.map_id).active_job_id is None


class TestWorker:
    def _env(self, workspace, job) -> dict[str, str]:
        return {
            worker.JOB_ENV: f"{CAMPAIGN}/{job.id}",
            worker.WORKDIR_ENV: str(workspace.root),
            worker.MAX_PIXELS_ENV: "1000",
        }

    def test_runs_the_queued_job_with_the_configured_limit(self, workspace, job, monkeypatch):
        seen = {}

        def execute(space, record, max_pixels):
            seen["max_pixels"] = max_pixels
            record.status = "done"

        monkeypatch.setattr(worker, "execute", execute)
        assert worker.main(self._env(workspace, job)) == 0
        assert seen == {"max_pixels": 1000}

    def test_a_failed_job_is_a_non_zero_exit(self, workspace, job, monkeypatch):
        def execute(space, record, max_pixels):
            record.status = "failed"

        monkeypatch.setattr(worker, "execute", execute)
        assert worker.main(self._env(workspace, job)) == 1

    def test_a_job_swept_before_the_worker_started_is_left_alone(self, workspace, job, monkeypatch):
        job.status = "failed"
        workspace.write_job(job)
        monkeypatch.setattr(worker, "execute", lambda *a: pytest.fail("must not run"))
        assert worker.main(self._env(workspace, job)) == 0

    def test_an_unknown_job_is_an_error(self, workspace, job):
        env = {**self._env(workspace, job), worker.JOB_ENV: f"{CAMPAIGN}/{'d' * 32}"}
        assert worker.main(env) == 2

    def test_a_malformed_reference_is_rejected(self):
        with pytest.raises(ValueError):
            worker.parse_job_ref("nope")

    def test_a_container_url_selects_the_blob_workspace(self, monkeypatch):
        built = {}
        monkeypatch.setattr(
            blob.BlobWorkspace,
            "from_url",
            classmethod(lambda cls, url, cred, scratch_root=None: built.setdefault("url", url)),
        )
        monkeypatch.setattr(blob, "credential", lambda client_id: client_id)
        worker.workspace_from_env({worker.BLOB_URL_ENV: "https://acct.blob.core.windows.net/ae"})
        assert built == {"url": "https://acct.blob.core.windows.net/ae"}


def test_queued_jobs_get_longer_before_they_count_as_stale(job):
    job.heartbeat_at = jobs.now() - timedelta(seconds=jobs.STALE_AFTER_SECONDS + 1)
    assert not jobs.is_stale(job)
    job.heartbeat_at = jobs.now() - timedelta(seconds=jobs.QUEUED_STALE_AFTER_SECONDS + 1)
    assert jobs.is_stale(job)
