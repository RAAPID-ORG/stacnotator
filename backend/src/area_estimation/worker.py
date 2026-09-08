"""Run one area estimation job in a process of its own.

The entrypoint of a worker a deployment spins up per job: it reads which job
to run from the environment, finds the map in the shared workspace, executes
it and exits. It reads plain environment variables rather than the backend's
settings on purpose - a worker has no database and must not need one.

    AREA_ESTIMATION_JOB=<campaign_id>/<job_id> python -m src.area_estimation.worker
"""

import logging
import os
import sys
from pathlib import Path

from src.area_estimation.jobs import execute
from src.area_estimation.workspace import Workspace

logger = logging.getLogger(__name__)

JOB_ENV = "AREA_ESTIMATION_JOB"
WORKDIR_ENV = "AREA_ESTIMATION_WORKDIR"
MAX_PIXELS_ENV = "AREA_ESTIMATION_MAX_GRID_PIXELS"
DEFAULT_MAX_GRID_PIXELS = 200_000_000_000


def parse_job_ref(value: str) -> tuple[int, str]:
    campaign, _, job_id = value.partition("/")
    if not campaign.isdigit() or not job_id:
        raise ValueError(f"{JOB_ENV} must be <campaign_id>/<job_id>, got {value!r}")
    return int(campaign), job_id


def main(environ: dict[str, str] | None = None) -> int:
    env = os.environ if environ is None else environ
    logging.basicConfig(level=logging.INFO, stream=sys.stdout)
    campaign_id, job_id = parse_job_ref(env.get(JOB_ENV, ""))
    workspace = Workspace(Path(env[WORKDIR_ENV]))
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
