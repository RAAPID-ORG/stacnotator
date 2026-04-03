"""Tiler service - standalone tile server reading mosaic data from shared DB."""

import logging
from contextlib import asynccontextmanager

import rasterio
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from titiler.core.errors import DEFAULT_STATUS_CODES, add_exception_handlers
from titiler.core.factory import MultiBaseTilerFactory, TilerFactory

from src.config import get_settings
from src.reader import PCSignedSTACReader
from src.stats import router as stats_router
from src.tiles import router as tiles_router

logging.basicConfig(level=logging.INFO)
logging.getLogger("rasterio").setLevel(logging.ERROR)
logging.getLogger("rio_tiler").setLevel(logging.WARNING)
logging.getLogger("httpx").setLevel(logging.WARNING)
logger = logging.getLogger(__name__)

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    with rasterio.Env(
        GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR",
        GDAL_HTTP_MERGE_CONSECUTIVE_RANGES="NO",
        GDAL_HTTP_MULTIPLEX="YES",
        GDAL_HTTP_TIMEOUT=60,
        GDAL_HTTP_MAX_RETRY=3,
        GDAL_HTTP_RETRY_DELAY=1,
        VSI_CACHE="TRUE",
        VSI_CACHE_SIZE=536870912,
        CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif,.tiff",
        GDAL_CACHEMAX=256,
        AWS_NO_SIGN_REQUEST="YES",
    ):
        yield


app = FastAPI(
    title="STACNotator Tiler",
    description="Tile serving service for STACNotator.",
    version="1.0.0",
    lifespan=lifespan,
)

origins = [o.strip() for o in settings.CORS_ORIGINS.split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_methods=["GET"],
    allow_headers=["*"],
)

app.include_router(tiles_router)
app.include_router(stats_router)

stac_tiler = MultiBaseTilerFactory(reader=PCSignedSTACReader, router_prefix="/stac")
cog_tiler = TilerFactory(router_prefix="/cog")
app.include_router(stac_tiler.router, tags=["STAC Tiles"])
app.include_router(cog_tiler.router, tags=["COG Tiles"])

add_exception_handlers(app, DEFAULT_STATUS_CODES)


@app.get("/healthz")
def health():
    return {"status": "ok"}
