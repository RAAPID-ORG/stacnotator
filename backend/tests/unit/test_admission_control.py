import asyncio
from types import SimpleNamespace

import pytest
from starlette.responses import PlainTextResponse

from src.main import RequestContextMiddleware


class _Request:
    """Only the parts the middleware reads."""

    def __init__(self, path: str):
        self.headers: dict[str, str] = {}
        self.method = "GET"
        self.url = SimpleNamespace(path=path)
        self.state = SimpleNamespace()


@pytest.fixture(autouse=True)
def _isolate_module_state():
    """The middleware reads process-wide state, so restore both around every test -
    a leaked settings object or in-flight count would surface as an unrelated
    failure elsewhere in the suite."""
    import src.main as main

    original_settings = main.settings
    RequestContextMiddleware._inflight = 0
    yield
    RequestContextMiddleware._inflight = 0
    main.settings = original_settings


def _middleware(limit: int) -> RequestContextMiddleware:
    import src.main as main

    main.settings = SimpleNamespace(MAX_INFLIGHT_REQUESTS=limit, SLOW_REQUEST_MS=1_000_000)
    return RequestContextMiddleware(app=None)


async def _ok(_request):
    return PlainTextResponse("ok")


def _dispatch(mw, path="/api/campaigns/1"):
    return asyncio.run(mw.dispatch(_Request(path), _ok))


def test_a_request_is_served_normally_below_the_limit():
    mw = _middleware(limit=5)
    assert _dispatch(mw).status_code == 200


def test_a_request_is_shed_with_503_once_the_limit_is_reached():
    """Refusing the excess is the point: a request that cannot get a connection
    should fail fast rather than occupy a thread until the worker is killed."""
    mw = _middleware(limit=2)
    RequestContextMiddleware._inflight = 2
    response = _dispatch(mw)
    assert response.status_code == 503
    assert response.headers["Retry-After"] == "2"


def test_shedding_does_not_leak_the_inflight_count():
    """A shed request never entered, so it must not decrement on the way out."""
    mw = _middleware(limit=2)
    RequestContextMiddleware._inflight = 2
    _dispatch(mw)
    assert RequestContextMiddleware._inflight == 2


def test_the_inflight_count_returns_to_zero_after_a_served_request():
    mw = _middleware(limit=5)
    _dispatch(mw)
    assert RequestContextMiddleware._inflight == 0


@pytest.mark.parametrize("path", ["/healthz", "/readyz"])
def test_health_probes_are_never_shed(path):
    """A 503 to the orchestrator reads as 'restart me', which is worse than busy."""
    mw = _middleware(limit=1)
    RequestContextMiddleware._inflight = 50
    assert _dispatch(mw, path).status_code == 200


def test_a_limit_of_zero_disables_shedding():
    mw = _middleware(limit=0)
    RequestContextMiddleware._inflight = 500
    assert _dispatch(mw).status_code == 200


def test_a_shed_response_still_carries_the_request_id():
    """Losing the correlation id on exactly the responses you need to trace would
    make the shedding invisible in the logs."""
    mw = _middleware(limit=1)
    RequestContextMiddleware._inflight = 1
    response = _dispatch(mw)
    assert response.headers["X-Request-ID"]
