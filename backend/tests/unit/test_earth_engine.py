"""DB-free tests for the Earth Engine init retry gate."""

import pytest

from src import earth_engine


@pytest.fixture(autouse=True)
def reset_state(monkeypatch):
    earth_engine._ready = False
    earth_engine._last_attempt = None
    monkeypatch.setattr(earth_engine, "_is_configured", lambda: True)
    yield
    earth_engine._ready = False
    earth_engine._last_attempt = None


def test_successful_init_is_sticky(monkeypatch):
    attempts = []

    def init_ok():
        attempts.append(1)
        return True

    monkeypatch.setattr(earth_engine, "_try_initialize", init_ok)
    assert earth_engine.ensure_earth_engine() is True
    assert earth_engine.ensure_earth_engine() is True
    assert len(attempts) == 1


def test_failed_init_is_not_retried_within_cooldown(monkeypatch):
    clock = {"now": 1000.0}
    monkeypatch.setattr(earth_engine.time, "monotonic", lambda: clock["now"])
    attempts = []

    def init_fail():
        attempts.append(1)
        return False

    monkeypatch.setattr(earth_engine, "_try_initialize", init_fail)
    assert earth_engine.ensure_earth_engine() is False
    clock["now"] += earth_engine._RETRY_COOLDOWN_SECONDS - 1
    assert earth_engine.ensure_earth_engine() is False
    assert len(attempts) == 1


def test_failed_init_is_retried_after_cooldown(monkeypatch):
    clock = {"now": 1000.0}
    monkeypatch.setattr(earth_engine.time, "monotonic", lambda: clock["now"])
    outcomes = [False, True]
    monkeypatch.setattr(earth_engine, "_try_initialize", lambda: outcomes.pop(0))

    assert earth_engine.ensure_earth_engine() is False
    clock["now"] += earth_engine._RETRY_COOLDOWN_SECONDS
    assert earth_engine.ensure_earth_engine() is True
    assert earth_engine.ensure_earth_engine() is True
    assert outcomes == []


def test_unconfigured_never_attempts_init(monkeypatch):
    monkeypatch.setattr(earth_engine, "_is_configured", lambda: False)
    monkeypatch.setattr(
        earth_engine, "_try_initialize", lambda: pytest.fail("must not init without config")
    )
    assert earth_engine.ensure_earth_engine() is False
