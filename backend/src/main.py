import logging.config
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from src.annotation.router import router as annotations_router
from src.auth.router import router as auth_router
from src.campaigns.router import router as campaigns_router
from src.config import get_settings
from src.imagery.router import router as imagery_router
from src.sampling_design.router import router as sampling_design_router
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

# Set all CORS enabled origins
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS", "PATCH", "DELETE", "PUT"],
    allow_headers=["*"],
)

# Include actual routers from each module with /api prefix
app.include_router(auth_router, prefix="/api")
app.include_router(campaigns_router, prefix="/api")
app.include_router(annotations_router, prefix="/api")
app.include_router(timeseries_router, prefix="/api")
app.include_router(sampling_design_router, prefix="/api")
app.include_router(imagery_router, prefix="/api")
