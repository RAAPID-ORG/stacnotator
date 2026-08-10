"""DB-free tests for the background-run liveness protocol (src/background.py)."""

from contextlib import nullcontext
from types import SimpleNamespace
from unittest.mock import ANY, MagicMock

import pytest

from src import background

FIELD = background.StatusField(
    status_column="registration_status",
    heartbeat_column="registration_heartbeat_at",
    interrupted_error="interrupted - retry",
)


class _InlineThread:
    """Stand-in for threading.Thread that runs the target synchronously."""

    def __init__(self, target, daemon=True, name=None):
        self._target = target

    def start(self):
        self._target()


@pytest.fixture()
def run_inline(monkeypatch):
    """Make spawn_status_run synchronous with the heartbeat machinery stubbed
    out (the real heartbeat thread would block an inline run)."""
    monkeypatch.setattr(background.threading, "Thread", _InlineThread)
    monkeypatch.setattr(background, "heartbeat", lambda *a, **k: nullcontext())


class TestBeginStatusRun:
    def test_marks_registering_and_stamps_a_heartbeat_in_the_same_write(self):
        campaign = SimpleNamespace(registration_status="ready", registration_heartbeat_at=None)
        background.begin_status_run(campaign, FIELD)
        assert campaign.registration_status == "registering"
        assert campaign.registration_heartbeat_at is not None


class TestSpawnStatusRun:
    def _spawn(self, work, sanitize=lambda exc: f"prefix: {exc}"):
        db = MagicMock()
        finish = MagicMock()
        with pytest.MonkeyPatch.context() as mp:
            mp.setattr(background, "SessionLocal", lambda: db)
            mp.setattr(background, "finish_status_run", finish)
            background.spawn_status_run(
                7, FIELD, name="test run", work=work, sanitize_error=sanitize
            )
        return db, finish

    def test_success_finishes_ready_with_no_errors(self, run_inline):
        db, finish = self._spawn(lambda db: None)
        finish.assert_called_once_with(db, 7, field=FIELD, status="ready", errors=[])
        db.commit.assert_called()
        db.close.assert_called()

    def test_partial_errors_finish_failed_with_those_errors(self, run_inline):
        errors = [{"error": "slice A failed"}]
        _, finish = self._spawn(lambda db: errors)
        finish.assert_called_once_with(ANY, 7, field=FIELD, status="failed", errors=errors)

    def test_raised_exception_finishes_failed_with_the_sanitized_message(self, run_inline):
        def work(db):
            raise RuntimeError("boom")

        db, finish = self._spawn(work)
        db.rollback.assert_called()
        finish.assert_called_once_with(
            db, 7, field=FIELD, status="failed", errors=[{"error": "prefix: boom"}]
        )
        db.close.assert_called()

    def test_failure_rolls_back_the_poisoned_session_before_finishing(self, run_inline):
        """A DB error mid-work leaves the session's transaction invalid; the
        failure status write must happen on a rolled-back session or it would
        raise PendingRollbackError and the status would stick at registering."""
        calls = []
        db = MagicMock()
        db.rollback.side_effect = lambda: calls.append("rollback")
        finish = MagicMock(side_effect=lambda *a, **k: calls.append("finish"))

        def work(_db):
            raise RuntimeError("db exploded")

        with pytest.MonkeyPatch.context() as mp:
            mp.setattr(background, "SessionLocal", lambda: db)
            mp.setattr(background, "finish_status_run", finish)
            background.spawn_status_run(7, FIELD, name="test run", work=work, sanitize_error=str)

        assert calls == ["rollback", "finish"]

    def test_session_closes_even_when_the_failure_write_itself_raises(self, run_inline):
        db = MagicMock()
        finish = MagicMock(side_effect=RuntimeError("db still down"))

        def work(_db):
            raise RuntimeError("boom")

        with pytest.MonkeyPatch.context() as mp:
            mp.setattr(background, "SessionLocal", lambda: db)
            mp.setattr(background, "finish_status_run", finish)
            background.spawn_status_run(7, FIELD, name="test run", work=work, sanitize_error=str)

        db.close.assert_called()


class TestHeartbeat:
    def test_stamps_on_entry_and_stops_with_the_block(self, monkeypatch):
        stamps = []
        monkeypatch.setattr(background, "_stamp_heartbeat", lambda cid, f: stamps.append((cid, f)))
        with background.heartbeat(7, FIELD):
            assert stamps == [(7, FIELD)]
        # Interval is 30s, so the side thread never beat during the block; the
        # context exit joined it, and no further stamps can occur.
        assert stamps == [(7, FIELD)]


class TestFailStaleStatusRuns:
    def test_one_update_per_field_guarding_on_status_and_stale_heartbeat(self):
        db = MagicMock()
        db.execute.return_value.scalars.return_value.all.return_value = [3]

        flipped = background.fail_stale_status_runs(db, (FIELD,))

        assert flipped == 1
        sql = str(db.execute.call_args.args[0])
        assert "registration_status = 'failed'" in sql
        assert "registration_status = 'registering'" in sql
        assert "registration_heartbeat_at IS NULL" in sql
        assert "make_interval" in sql
        assert "id = :campaign_id" not in sql

    def test_campaign_filter_scopes_the_update(self):
        db = MagicMock()
        db.execute.return_value.scalars.return_value.all.return_value = []

        flipped = background.fail_stale_status_runs(db, (FIELD,), campaign_id=42)

        assert flipped == 0
        sql = str(db.execute.call_args.args[0])
        params = db.execute.call_args.args[1]
        assert "id = :campaign_id" in sql
        assert params["campaign_id"] == 42

    def test_the_retry_hint_is_what_gets_appended(self):
        db = MagicMock()
        db.execute.return_value.scalars.return_value.all.return_value = [3]

        background.fail_stale_status_runs(db, (FIELD,))

        params = db.execute.call_args.args[1]
        assert "interrupted - retry" in params["interrupted"]
