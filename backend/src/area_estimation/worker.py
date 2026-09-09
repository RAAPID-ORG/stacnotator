"""Run one area estimation job in a process of its own.

The entrypoint of a worker a deployment spins up per job: it reads which job
to run from the environment, opens the workspace the backend shares with it,
executes the job and exits. It reads plain environment variables rather than
the backend's settings on purpose - a worker has no database and must not
need one.

    AREA_ESTIMATION_JOB=<campaign_id>/<job_id> \\
    AREA_ESTIMATION_BLOB_CONTAINER_URL=https://<account>.blob.core.windows.net/<container> \\
    python -m src.area_estimation.worker
"""

import logging
import os
import sys
from pathlib import Path

from src.area_estimation.jobs import execute
from src.area_estimation.workspace import LocalWorkspace, Workspace

logger = logging.getLogger(__name__)

JOB_ENV = "AREA_ESTIMATION_JOB"
WORKDIR_ENV = "AREA_ESTIMATION_WORKDIR"
BLOB_URL_ENV = "AREA_ESTIMATION_BLOB_CONTAINER_URL"
CLIENT_ID_ENV = "AREA_ESTIMATION_AZURE_CLIENT_ID"
MAX_PIXELS_ENV = "AREA_ESTIMATION_MAX_GRID_PIXELS"
DEFAULT_MAX_GRID_PIXELS = 200_000_000_000


def parse_job_ref(value: str) -> tuple[int, str]:
    campaign, _, job_id = value.partition("/")
    if not campaign.isdigit() or not job_id:
        raise ValueError(f"{JOB_ENV} must be <campaign_id>/<job_id>, got {value!r}")
    return int(campaign), job_id


def workspace_from_env(env: dict[str, str]) -> Workspace:
    """A blob container when one is named, else a directory: the same choice the
    backend makes from its settings, read here from the environment."""
    container_url = env.get(BLOB_URL_ENV)
    if container_url:
        from src.area_estimation.blob import BlobWorkspace, credential  # noqa: PLC0415

        return BlobWorkspace.from_url(container_url, credential(env.get(CLIENT_ID_ENV)))
    return LocalWorkspace(Path(env[WORKDIR_ENV]))


def main(environ: dict[str, str] | None = None) -> int:
    env = dict(os.environ) if environ is None else environ
    logging.basicConfig(level=logging.INFO, stream=sys.stdout)
    campaign_id, job_id = parse_job_ref(env.get(JOB_ENV, ""))
    workspace = workspace_from_env(env)
    max_pixels = int(env.get(MAX_PIXELS_ENV, DEFAULT_MAX_GRID_PIXELS))

    job = workspace.read_job(campaign_id, job_id)
    if job is None:
        logger.error("Job %s of campaign %d is not in the workspace", job_id, campaign_id)
        return 2
    # Only a queued job is ours to run. Anything else was already run, or was
    # swept as abandoned while this worker was still starting.
    if job.status != "queued":
        logger.warning("Job %s is %s, not queued; nothing to do", job_id, job.status)
        return 0
    execute(workspace, job, max_pixels)
    return 0 if job.status == "done" else 1


if __name__ == "__main__":
    raise SystemExit(main())
