"""A Runner that hands each job to an Azure Container Apps Job execution.

The backend and the job share one workspace - the blob container - so
submitting a job is nothing more than starting an execution of the worker
image with the job's id in its environment; the worker reads the job from
the workspace and writes its outcome back, exactly as the local runner's
thread would. The execution is started through the management API as the
backend's own identity.

The management host is fixed, never chosen by a user, which is why the call
does not go through net_guard.
"""

import logging

import httpx
from azure.core.credentials import TokenCredential

from src.area_estimation.jobs import now, release_map
from src.area_estimation.schemas import JobRecord
from src.area_estimation.worker import JOB_ENV
from src.area_estimation.workspace import Workspace

logger = logging.getLogger(__name__)

MANAGEMENT = "https://management.azure.com"
MANAGEMENT_SCOPE = f"{MANAGEMENT}/.default"
API_VERSION = "2024-03-01"
START_FAILED_ERROR = "The processing worker could not be started; try again"
# What an execution may override of the job's own template.
OVERRIDABLE = ("name", "image", "command", "args", "resources")


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
        cred: TokenCredential,
        client: httpx.Client,
    ):
        self._workspace = workspace
        self._job_url = f"{MANAGEMENT}{job_resource_id}"
        self._credential = cred
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
            release_map(self._workspace, job)

    def _start(self, job: JobRecord) -> None:
        token = self._credential.get_token(MANAGEMENT_SCOPE).token
        headers = {"Authorization": f"Bearer {token}"}
        params = {"api-version": API_VERSION}
        definition = self._client.get(self._job_url, params=params, headers=headers)
        definition.raise_for_status()
        containers = definition.json()["properties"]["template"]["containers"]
        reference = f"{job.campaign_id}/{job.id}"
        override = [
            {
                **{k: v for k, v in container.items() if k in OVERRIDABLE},
                "env": [*(container.get("env") or []), {"name": JOB_ENV, "value": reference}],
            }
            for container in containers
        ]
        started = self._client.post(
            f"{self._job_url}/start", params=params, headers=headers, json={"containers": override}
        )
        started.raise_for_status()
        logger.info(
            "Started worker execution %s for area estimation job %s",
            started.json().get("name", "?"),
            job.id,
        )
