"""A Runner that hands each job to an Azure Container Apps Job execution.

The backend and the job share one workspace on a mounted file share, so
submitting a job is nothing more than starting an execution of the worker
image with the job's id in its environment; the worker reads the job from
the share and writes its outcome back, exactly as the local runner's thread
would. Authentication is the backend's managed identity, obtained from the
platform's identity endpoint.

The two hosts this module talks to are fixed by the operator's configuration,
never by a user, which is why the requests do not go through net_guard: the
identity endpoint is link-local by design and would be refused by it.
"""

import logging
import os
import threading
import time
from dataclasses import dataclass

import httpx

from src.area_estimation.jobs import now
from src.area_estimation.schemas import JobRecord
from src.area_estimation.worker import JOB_ENV
from src.area_estimation.workspace import Workspace

logger = logging.getLogger(__name__)

MANAGEMENT = "https://management.azure.com"
API_VERSION = "2024-03-01"
IMDS_ENDPOINT = "http://169.254.169.254/metadata/identity/oauth2/token"
TOKEN_REFRESH_MARGIN_SECONDS = 300
START_FAILED_ERROR = "The processing worker could not be started; try again"


@dataclass
class _Token:
    value: str
    expires_at: float


class ManagedIdentity:
    """Bearer tokens for the management API from the container's identity.

    Container Apps expose the identity through IDENTITY_ENDPOINT and
    IDENTITY_HEADER; a VM would offer the IMDS endpoint instead. Tokens are
    cached until shortly before they expire.
    """

    def __init__(self, client: httpx.Client, client_id: str | None = None):
        self._client = client
        self._client_id = client_id
        self._token: _Token | None = None
        self._lock = threading.Lock()

    def bearer(self) -> str:
        with self._lock:
            if (
                self._token is None
                or self._token.expires_at - time.time() < TOKEN_REFRESH_MARGIN_SECONDS
            ):
                self._token = self._fetch()
            return self._token.value

    def _fetch(self) -> _Token:
        params: dict[str, str] = {"resource": f"{MANAGEMENT}/"}
        if self._client_id:
            params["client_id"] = self._client_id
        endpoint = os.environ.get("IDENTITY_ENDPOINT")
        if endpoint:
            params["api-version"] = "2019-08-01"
            headers = {"X-IDENTITY-HEADER": os.environ.get("IDENTITY_HEADER", "")}
        else:
            endpoint = IMDS_ENDPOINT
            params["api-version"] = "2018-02-01"
            headers = {"Metadata": "true"}
        response = self._client.get(endpoint, params=params, headers=headers)
        response.raise_for_status()
        body = response.json()
        return _Token(value=body["access_token"], expires_at=float(body["expires_on"]))


class AzureJobRunner:
    """Starts one Container Apps Job execution per submitted job.

    ``job_resource_id`` is the job's ARM id
    (/subscriptions/../resourceGroups/../providers/Microsoft.App/jobs/<name>).
    The job's own template says which image and command to run; the execution
    only adds the job reference to the container's environment.
    """

    def __init__(
        self,
        workspace: Workspace,
        job_resource_id: str,
        identity: ManagedIdentity,
        client: httpx.Client,
    ):
        self._workspace = workspace
        self._job_url = f"{MANAGEMENT}{job_resource_id}"
        self._identity = identity
        self._client = client

    def submit(self, job: JobRecord) -> None:
        try:
            self._start(job)
        except Exception:
            logger.exception("Could not start a worker for area estimation job %s", job.id)
            # Told now rather than after the stale sweep: nobody is coming.
            job.status = "failed"
            job.error = START_FAILED_ERROR
            job.finished_at = now()
            self._workspace.write_job(job)
            record = self._workspace.read_map(job.campaign_id, job.map_id)
            if record is not None and record.active_job_id == job.id:
                record.active_job_id = None
                self._workspace.write_map(record)

    def _start(self, job: JobRecord) -> None:
        headers = {"Authorization": f"Bearer {self._identity.bearer()}"}
        params = {"api-version": API_VERSION}
        definition = self._client.get(self._job_url, params=params, headers=headers)
        definition.raise_for_status()
        containers = definition.json()["properties"]["template"]["containers"]
        reference = f"{job.campaign_id}/{job.id}"
        override = [
            {
                **{
                    k: v
                    for k, v in container.items()
                    if k in ("name", "image", "command", "args", "resources")
                },
                "env": [*(container.get("env") or []), {"name": JOB_ENV, "value": reference}],
            }
            for container in containers
        ]
        started = self._client.post(
            f"{self._job_url}/start",
            params=params,
            headers=headers,
            json={"containers": override},
        )
        started.raise_for_status()
        logger.info(
            "Started worker execution %s for area estimation job %s",
            started.json().get("name", "?"),
            job.id,
        )
