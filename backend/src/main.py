import logging.config
from contextlib import asynccontextmanager
from pathlib import Path
from time import perf_counter
from uuid import uuid4

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text
from starlette.datastructures import MutableHeaders
from starlette.middleware.base import BaseHTTPMiddleware

import src.models  # noqa: F401 -- side-effect import: ensures all ORM models are registered before any mapper configures  # isort: skip

from src import perf
from src.annotation.embeddings_service import EMBEDDING_RUN
from src.annotation.router import router as annotations_router
from src.auth.router import router as auth_router
from src.background import fail_stale_status_runs
from src.campaigns.router import router as campaigns_router
from src.config import (
    DEV_APIKEY_ENCRYPTION_SECRET,
    DEV_TILER_TOKEN_SECRET,
    get_settings,
)
from src.custom_layers.router import router as custom_layers_router
from src.database import SessionLocal
from src.earth_engine import initialize_earth_engine
from src.imagery.proxy_router import router as imagery_proxy_router
from src.imagery.registration import REGISTRATION_RUN
from src.imagery.router import router as imagery_router
from src.organizations.router import router as organizations_router
from src.planet.router import router as planet_router
from src.projects.router import router as projects_router
from src.routing import generate_unique_id
from src.sampling_design.router import router as sampling_design_router
from src.stac_browser.router import router as stac_browser_router
from src.tile_bulkhead import TileCapacityError
from src.timeseries.router import router as timeseries_router

settings = get_settings()

# Setup Logging
BASE_DIR = Path(__file__).resolve().parent.parent
LOGGING_CONFIG = BASE_DIR / "logging.ini"

logging.config.fileConfig(
    LOGGING_CONFIG,
    disable_existing_loggers=False,
)

logger = logging.getLogger(__name__)


def _validate_production_config() -> None:
    s = get_settings()
    if s.ENVIRONMENT != "production":
        return
    if s.TILER_TOKEN_SECRET == DEV_TILER_TOKEN_SECRET:
        raise RuntimeError("TILER_TOKEN_SECRET must be changed from the dev default in production")
    if s.APIKEY_ENCRYPTION_SECRET == DEV_APIKEY_ENCRYPTION_SECRET:
        raise RuntimeError(
            "APIKEY_ENCRYPTION_SECRET must be changed from the dev default in production"
        )
    if (
        s.AUTH_PROVIDER == "firebase"
        and not s.FIREBASE_CREDENTIALS_PATH
        and not s.FIREBASE_CREDENTIALS
    ):
        raise RuntimeError(
            "FIREBASE_CREDENTIALS_PATH or FIREBASE_CREDENTIALS must be set "
            "when AUTH_PROVIDER=firebase in production"
        )


@asynccontextmanager
async def lifespan(app: FastAPI):
    _validate_production_config()
    # Sync routes and their sync `get_db` cleanup share this pool; if it saturates,
    # cleanup is starved and connections leak. Size it above the DB pool so cleanup
    # always has a thread. DB concurrency stays capped by the (small) DB pool.
    from anyio import to_thread

    to_thread.current_default_thread_limiter().total_tokens = settings.THREAD_POOL_MAX
    initialize_earth_engine()
    _sweep_stale_background_runs()
    yield


def _sweep_stale_background_runs() -> None:
    """Recover campaigns whose background run died with a previous worker.

    Guarded: a DB hiccup at boot must not keep the worker from serving - the
    sweep re-runs on every worker start and from the polled campaign read.
    """
    try:
        db = SessionLocal()
        try:
            fail_stale_status_runs(db, (REGISTRATION_RUN, EMBEDDING_RUN))
            db.commit()
        finally:
            db.close()
    except Exception:
        logger.warning("Stale background-run sweep failed at startup", exc_info=True)


# Initialize the FastAPI app
_is_production = settings.ENVIRONMENT == "production"
app = FastAPI(
    title="STACNotator",
    openapi_url=None if _is_production else "/api/openapi.json",
    docs_url=None if _is_production else "/api/docs",
    description="STACNotator - A Tool for Annotating Imagery from STAC Catalogs.",
    generate_unique_id_function=generate_unique_id,
    lifespan=lifespan,
)


class RequestContextMiddleware(BaseHTTPMiddleware):
    """Attach a UUID to each request as request.state.request_id and echo it
    back in the X-Request-ID response header. Honours an inbound X-Request-ID
    when present so callers can trace through to upstream logs.

    Also times the request: every response carries X-Response-Time-ms (so a
    client can split its round-trip into server time and network), and anything
    slower than SLOW_REQUEST_MS is logged once with a full breakdown of where that
    time went (see src/perf.py) plus the process-wide contention at the time, which
    is what separates "this endpoint is slow" from "the worker was busy".
    """

    _inflight = 0
    _tile_inflight = 0

    # Admission control. A worker that accepts more work than it can run collapses
    # rather than degrading: everything queues, breaches gunicorn's timeout together,
    # and the worker is killed with its in-flight requests. Refusing the excess costs
    # those requests and saves the rest. Probes are exempt - a 503 to the orchestrator
    # reads as "restart me".
    _ALWAYS_ADMIT = frozenset({"/healthz", "/readyz"})

    async def dispatch(self, request: Request, call_next):
        request_id = request.headers.get("X-Request-ID") or str(uuid4())
        request.state.request_id = request_id
        timing = perf.start()

        cls = RequestContextMiddleware
        path = request.url.path
        is_tile = _is_proxy_tile(path)
        limit = settings.MAX_INFLIGHT_TILE_REQUESTS if is_tile else settings.MAX_INFLIGHT_REQUESTS
        current = cls._tile_inflight if is_tile else cls._inflight

        if limit and current >= limit and path not in cls._ALWAYS_ADMIT:
            logger.warning(
                "Shedding request | %s %s inflight=%d limit=%d tile=%s request_id=%s",
                request.method,
                path,
                current,
                limit,
                is_tile,
                request_id,
            )
            return JSONResponse(
                status_code=503,
                content={"detail": "Server busy, retry shortly", "request_id": request_id},
                headers={"Retry-After": "2", "X-Request-ID": request_id},
            )

        if is_tile:
            cls._tile_inflight += 1
        else:
            cls._inflight += 1
        try:
            response = await call_next(request)
        finally:
            if is_tile:
                cls._tile_inflight -= 1
            else:
                cls._inflight -= 1
        elapsed_ms = (perf_counter() - timing.started) * 1000
        response.headers["X-Request-ID"] = request_id
        response.headers["X-Response-Time-ms"] = f"{elapsed_ms:.0f}"

        slow = elapsed_ms >= settings.SLOW_REQUEST_MS
        if slow or settings.LOG_REQUEST_TIMING:
            logger.log(
                logging.WARNING if slow else logging.INFO,
                "perf | %s %s %s %.0fms %s inflight=%d tiles=%d request_id=%s",
                request.method,
                _route_template(request),
                response.status_code,
                elapsed_ms,
                perf.breakdown(timing),
                RequestContextMiddleware._inflight,
                RequestContextMiddleware._tile_inflight,
                request_id,
            )
        return response


def _is_proxy_tile(path: str) -> bool:
    """Whether this is an imagery proxy tile, which gets its own admission budget.

    Proxy tiles only. Annotation vector tiles also live under a ``/tiles/`` path but do
    real database work, so they stay under the API's budget where that work is counted.
    Matched on the raw path because the route is not resolved until after this
    middleware has already decided whether to admit the request.
    """
    return "/imagery/" in path and "/tiles/" in path


def _route_template(request: Request) -> str:
    """The matched route's pattern, not the concrete path. Tile URLs carry z/x/y, so
    logging the raw path would make every tile its own log series."""
    route = request.scope.get("route")
    return getattr(route, "path", None) or request.url.path


SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
}


class SecurityHeadersMiddleware:
    """Stamp response hardening headers on every API response.

    The SWA frontend gets these from staticwebapp.config.json, but API responses come
    from a different origin and had none of their own. nosniff is the one that earns
    its keep: the tile proxy returns bytes an upstream we don't own chose.

    Plain ASGI rather than BaseHTTPMiddleware - this sits on the tile path.
    """

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        async def send_stamped(message):
            if message["type"] == "http.response.start":
                headers = MutableHeaders(scope=message)
                for name, value in SECURITY_HEADERS.items():
                    headers.setdefault(name, value)
            await send(message)

        await self.app(scope, receive, send_stamped)


app.add_middleware(RequestContextMiddleware)
app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(GZipMiddleware, minimum_size=1024)


@app.exception_handler(HTTPException)
def handle_http_exception(request: Request, exc: HTTPException):
    """Standard HTTPException response with request_id attached so users can
    quote a reference to support."""
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "detail": exc.detail,
            "request_id": getattr(request.state, "request_id", None),
        },
        headers=exc.headers,
    )


@app.exception_handler(RequestValidationError)
def handle_validation_error(request: Request, exc: RequestValidationError):
    """Flatten pydantic errors to {field, msg} pairs. Hides the internal
    request shape (loc paths) and the raw input value."""
    errors = [
        {
            "field": str(err["loc"][-1]) if err.get("loc") else None,
            "msg": err.get("msg", "Invalid input"),
        }
        for err in exc.errors()
    ]
    return JSONResponse(
        status_code=422,
        content={
            "detail": errors,
            "request_id": getattr(request.state, "request_id", None),
        },
    )


@app.exception_handler(TileCapacityError)
def handle_tile_capacity(request: Request, exc: TileCapacityError):
    """Tiles are shed, not queued forever, once the bulkhead is saturated."""
    logger.info("Tile shed under load | path=%s", request.url.path)
    return JSONResponse(
        status_code=503,
        content={
            "detail": "Tile capacity reached",
            "request_id": getattr(request.state, "request_id", None),
        },
        headers={"Retry-After": "1"},
    )


@app.exception_handler(Exception)
def handle_uncaught_exception(request: Request, exc: Exception):
    """Catch-all for anything not raised as HTTPException. Logs the full
    traceback server-side with the request_id; returns a sanitized response
    with no exception details. Wire an observability sink (Sentry/Datadog)
    where indicated below."""
    request_id = getattr(request.state, "request_id", None)
    # exc_info=exc, not logger.exception(): this handler is sync, so Starlette
    # dispatches it via run_in_threadpool, where thread-local sys.exc_info() is
    # empty and the traceback would be logged as "NoneType: None".
    logger.error(
        "Unhandled exception | request_id=%s path=%s method=%s",
        request_id,
        request.url.path,
        request.method,
        exc_info=exc,
    )
    # OBSERVABILITY: forward `exc` here with request_id, user_id (if available),
    # path, method as tags. Single point of integration.
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error", "request_id": request_id},
    )


# Set all CORS enabled origins.
# max_age=86400 caches the preflight for 24h so repeated saves in a session
# skip the OPTIONS round-trip (meaningful on cross-region deployments).
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS", "PATCH", "DELETE", "PUT"],
    allow_headers=["*"],
    expose_headers=["X-Request-ID", "X-Response-Time-ms"],
    max_age=86400,
)


@app.get("/healthz", include_in_schema=False)
def healthz():
    return {"status": "ok"}


@app.get("/readyz", include_in_schema=False)
def readyz():
    db = SessionLocal()
    try:
        db.execute(text("SELECT 1"))
        return {"status": "ok"}
    except Exception:
        return JSONResponse(status_code=503, content={"status": "degraded"})
    finally:
        db.close()


# Include actual routers from each module with /api prefix
app.include_router(auth_router, prefix="/api")
app.include_router(organizations_router, prefix="/api")
app.include_router(projects_router, prefix="/api")
app.include_router(campaigns_router, prefix="/api")
app.include_router(annotations_router, prefix="/api")
app.include_router(timeseries_router, prefix="/api")
app.include_router(sampling_design_router, prefix="/api")
app.include_router(imagery_router, prefix="/api")
app.include_router(imagery_proxy_router, prefix="/api")
app.include_router(stac_browser_router, prefix="/api")
app.include_router(planet_router, prefix="/api")
app.include_router(custom_layers_router, prefix="/api")
# Tile serving (mosaic tiles, STAC/COG tiles) is handled by the separate tiler service
