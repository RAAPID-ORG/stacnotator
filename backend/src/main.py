import logging.config
from contextlib import asynccontextmanager
from pathlib import Path
from uuid import uuid4

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from src.annotation.router import router as annotations_router
from src.auth.router import router as auth_router
from src.campaigns.router import router as campaigns_router
from src.config import get_settings
from src.imagery.router import router as imagery_router
from src.sampling_design.router import router as sampling_design_router
from src.tiling.router import router as tiling_router
from src.timeseries.router import router as timeseries_router
from src.utils import generate_unique_id, initialize_earth_engine

settings = get_settings()

# Setup Logging
BASE_DIR = Path(__file__).resolve().parent.parent
LOGGING_CONFIG = BASE_DIR / "logging.ini"

logging.config.fileConfig(
    LOGGING_CONFIG,
    disable_existing_loggers=False,
)

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Initialize earth engine
    initialize_earth_engine()
    yield


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


class RequestIDMiddleware(BaseHTTPMiddleware):
    """Attach a UUID to each request as request.state.request_id and echo it
    back in the X-Request-ID response header. Honours an inbound X-Request-ID
    when present so callers can trace through to upstream logs."""

    async def dispatch(self, request: Request, call_next):
        request_id = request.headers.get("X-Request-ID") or str(uuid4())
        request.state.request_id = request_id
        response = await call_next(request)
        response.headers["X-Request-ID"] = request_id
        return response


app.add_middleware(RequestIDMiddleware)
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


@app.exception_handler(Exception)
def handle_uncaught_exception(request: Request, exc: Exception):
    """Catch-all for anything not raised as HTTPException. Logs the full
    traceback server-side with the request_id; returns a sanitized response
    with no exception details. Wire an observability sink (Sentry/Datadog)
    where indicated below."""
    request_id = getattr(request.state, "request_id", None)
    logger.exception(
        "Unhandled exception | request_id=%s path=%s method=%s",
        request_id,
        request.url.path,
        request.method,
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
    max_age=86400,
)

# Include actual routers from each module with /api prefix
app.include_router(auth_router, prefix="/api")
app.include_router(campaigns_router, prefix="/api")
app.include_router(annotations_router, prefix="/api")
app.include_router(timeseries_router, prefix="/api")
app.include_router(sampling_design_router, prefix="/api")
app.include_router(imagery_router, prefix="/api")
app.include_router(tiling_router, prefix="/api")
# Tile serving (mosaic tiles, STAC/COG tiles) is handled by the separate tiler service
