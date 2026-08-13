"""Liveness protocol for campaign-scoped background runs.

Long-running background work executes on daemon threads inside web workers -
and web workers are disposable: gunicorn recycles them after --max-requests,
and the platform can kill them any time (deploy, scale, OOM). A killed worker
takes its threads with it, which would leave the run's status column stuck at
"registering" forever.

This module is mechanism only; it knows nothing about which runs exist. A
domain that owns background work declares a ``StatusField`` (its status and
heartbeat columns on data.campaigns, plus the user-facing message shown when a
dead run is swept) and drives it with:

- ``begin_status_run``: status = "registering" plus a fresh heartbeat, in the
  caller's transaction, committed before the spawn.
- ``spawn_status_run``: executes the work on a daemon thread with its own
  session, refreshes the heartbeat while the work runs, and flips the status
  to ready/failed via ``finish_status_run`` when it completes.
- ``fail_stale_status_runs``: the recovery sweep - a run still "registering"
  whose heartbeat stopped belongs to a dead worker and is flipped to "failed".
  Liveness is judged by the absence of writes, so recovery needs no
  cooperation from the dead process; a run wrongly flipped during a long DB
  outage self-corrects when its finish_status_run overwrites the status.
"""

import json
import logging
import threading
from collections.abc import Callable, Iterable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass

from sqlalchemy import func, text
from sqlalchemy.orm import Session

from src.database import SessionLocal

logger = logging.getLogger(__name__)

HEARTBEAT_INTERVAL_SECONDS = 30.0
# Six missed beats. Generous enough that a slow beat write never trips it,
# small enough that a user watching the polling UI is unblocked quickly.
STALE_AFTER_SECONDS = 180.0


@dataclass(frozen=True)
class StatusField:
    """One kind of background run: its column pair on data.campaigns and the
    registration_errors entry written when a dead run is swept."""

    status_column: str
    heartbeat_column: str
    interrupted_error: str


def begin_status_run(campaign, field: StatusField) -> None:
    """Mark a run as starting: status = "registering" plus a fresh heartbeat.

    Must happen in the caller's transaction, committed before spawn_status_run,
    so no observer can ever see "registering" without a heartbeat to judge it by.
    """
    setattr(campaign, field.status_column, "registering")
    setattr(campaign, field.heartbeat_column, func.now())


def _stamp_heartbeat(campaign_id: int, field: StatusField) -> None:
    """One beat, on its own short-lived connection so the pool is never held."""
    db = SessionLocal()
    try:
        db.execute(
            text(f"UPDATE data.campaigns SET {field.heartbeat_column} = now() WHERE id = :id"),
            {"id": campaign_id},
        )
        db.commit()
    except Exception:
        logger.warning("Heartbeat write failed for campaign %d", campaign_id, exc_info=True)
    finally:
        db.close()


@contextmanager
def heartbeat(campaign_id: int, field: StatusField) -> Iterator[None]:
    """Keep the run's heartbeat fresh for as long as the with-block executes.

    Stamps once on entry, then every HEARTBEAT_INTERVAL_SECONDS from a side
    thread. The side thread is a daemon: if the worker dies, the beat stops
    with it - that silence is exactly what fail_stale_status_runs detects.
    """
    stop = threading.Event()

    def _beat() -> None:
        while not stop.wait(HEARTBEAT_INTERVAL_SECONDS):
            _stamp_heartbeat(campaign_id, field)

    _stamp_heartbeat(campaign_id, field)
    thread = threading.Thread(
        target=_beat, daemon=True, name=f"heartbeat-{field.status_column}-{campaign_id}"
    )
    thread.start()
    try:
        yield
    finally:
        stop.set()
        thread.join(timeout=5)


def finish_status_run(
    db: Session,
    campaign_id: int,
    *,
    field: StatusField,
    status: str,
    errors: list[dict],
) -> None:
    """Atomically flip a run's status column and append to registration_errors.

    Two runs can finish the same campaign around the same time. A
    read-modify-write on registration_errors (read the list, append in Python,
    write the whole list back) lets whichever thread commits second silently
    overwrite the other's errors. This does the append inside the UPDATE
    itself, so both threads' errors survive no matter which commits first -
    the single writer of registration_errors is this statement.

    Does not commit; the caller commits alongside whatever else it writes in
    the same transaction.
    """
    # SessionLocal runs with autoflush=False: flush any ORM writes already staged
    # on this session, or this Core statement could run without seeing them.
    db.flush()
    db.execute(
        text(
            "UPDATE data.campaigns "
            "SET registration_errors = coalesce(registration_errors, '[]'::jsonb) "
            "        || cast(:new_errors AS jsonb), "
            f"    {field.status_column} = :status "
            "WHERE id = :campaign_id"
        ),
        {
            "new_errors": json.dumps(errors),
            "status": status,
            "campaign_id": campaign_id,
        },
    )


def spawn_status_run(
    campaign_id: int,
    field: StatusField,
    *,
    name: str,
    work: Callable[[Session], list[dict] | None],
    sanitize_error: Callable[[Exception], str],
) -> None:
    """Run ``work`` on a daemon thread with its own session and heartbeat.

    The caller must have committed begin_status_run first. ``work`` returns a
    list of error dicts for partial failures (empty/None = success) and raises
    for a total failure; either way the status column ends at ready/failed via
    finish_status_run. ``sanitize_error`` turns a raised exception into the
    user-facing registration_errors message.
    """

    def _run() -> None:
        db = SessionLocal()
        try:
            logger.info("Background %s started for campaign %d", name, campaign_id)
            with heartbeat(campaign_id, field):
                errors = work(db) or []
            finish_status_run(
                db,
                campaign_id,
                field=field,
                status="failed" if errors else "ready",
                errors=errors,
            )
            db.commit()
            if errors:
                logger.warning(
                    "Background %s for campaign %d finished with %d errors",
                    name,
                    campaign_id,
                    len(errors),
                )
            else:
                logger.info("Background %s completed for campaign %d", name, campaign_id)
        except Exception as exc:
            logger.exception("Background %s failed for campaign %d", name, campaign_id)
            db.rollback()
            try:
                finish_status_run(
                    db,
                    campaign_id,
                    field=field,
                    status="failed",
                    errors=[{"error": sanitize_error(exc)}],
                )
                db.commit()
            except Exception:
                logger.warning("Failed to persist %s failure status", name, exc_info=True)
        finally:
            db.close()

    threading.Thread(target=_run, daemon=True).start()


def fail_stale_status_runs(
    db: Session, fields: Iterable[StatusField], campaign_id: int | None = None
) -> int:
    """Flip dead runs ("registering" with a stale or missing heartbeat) to
    "failed" with the field's retry hint appended to registration_errors.

    The status guard is inside the UPDATE itself, so concurrent sweeps (several
    workers booting, or a sweep racing the poll endpoint) cannot double-append.
    Returns the number of runs flipped; the caller commits.
    """
    flipped = 0
    for field in fields:
        sql = (
            "UPDATE data.campaigns "
            "SET registration_errors = coalesce(registration_errors, '[]'::jsonb) "
            "        || cast(:interrupted AS jsonb), "
            f"    {field.status_column} = 'failed' "
            f"WHERE {field.status_column} = 'registering' "
            f"  AND ({field.heartbeat_column} IS NULL "
            f"       OR {field.heartbeat_column} < now() - make_interval(secs => :stale))"
        )
        params: dict = {
            "interrupted": json.dumps([{"error": field.interrupted_error}]),
            "stale": STALE_AFTER_SECONDS,
        }
        if campaign_id is not None:
            sql += " AND id = :campaign_id"
            params["campaign_id"] = campaign_id
        swept = db.execute(text(sql + " RETURNING id"), params).scalars().all()
        if swept:
            logger.warning(
                "Swept dead %s run(s) to 'failed' for campaign(s) %s",
                field.status_column,
                list(swept),
            )
        flipped += len(swept)
    return flipped
