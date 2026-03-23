"""
TiTiler with a single custom compositing endpoint.
No pgSTAC, no local metadata catalogue.

Your JS app passes the item hrefs it already has from its MPC search,
and this service composites + returns the tile.

Endpoint:
    GET /composite/{z}/{x}/{y}.png
        ?items=https://...B04.tif
        &items=https://...B04.tif
        &assets=B04,B03,B02
        &pixel_selection=median
        &rescale=0,3000
"""

import logging
from typing import Annotated, List, Literal

import planetary_computer
from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from rio_tiler.io import STACReader
from rio_tiler.mosaic import mosaic_reader
from rio_tiler.models import ImageData
from titiler.core.errors import DEFAULT_STATUS_CODES, add_exception_handlers
from titiler.core.utils import rescale_array
from rio_tiler.mosaic.methods import defaults as mosaic_defaults
from fastapi.responses import Response
import numpy as np
from rio_tiler.mosaic.methods.base import MosaicMethodBase
import asyncio
import httpx

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="TiTiler-MPC",
    description="Compositing tile server for Planetary Computer COGs",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET"],
    allow_headers=["*"],
)

add_exception_handlers(app, DEFAULT_STATUS_CODES)

# Pixel selection methods supported by rio_tiler
PIXEL_SELECTION_METHODS = {
    "first":   mosaic_defaults.FirstMethod,
    "highest": mosaic_defaults.HighestMethod,
    "lowest":  mosaic_defaults.LowestMethod,
    "mean":    mosaic_defaults.MeanMethod,
    "median":  mosaic_defaults.MedianMethod,
    "stdev":   mosaic_defaults.StdevMethod,
}

async def sign_item_async(client: httpx.AsyncClient, item_url: str) -> dict:
    resp = await client.get(item_url)
    resp.raise_for_status()
    return planetary_computer.sign(resp.json())

def sign_item(item_url: str) -> str:
    """Sign a MPC STAC item URL so its asset hrefs become valid SAS URLs."""
    import requests
    item = requests.get(item_url).json()
    return planetary_computer.sign(item)

@app.get("/composite/{z}/{x}/{y}")
async def composite_tile(
    z: int, x: int, y: int,
    items: Annotated[List[str], Query(...)],
    assets: Annotated[List[str], Query(...)] = ["B04", "B03", "B02"],
    pixel_selection: Annotated[
        Literal["first", "highest", "lowest", "mean", "median", "stdev", "ndvi_best"],
        Query()
    ] = "median",
    rescale: Annotated[str, Query()] = "0,3000",
    nir_band: Annotated[str, Query()] = "B08",
    red_band: Annotated[str, Query()] = "B04",
    mask_layer: Annotated[str, Query(
        description="Asset name to use as pixel mask, e.g. SCL"
    )] = "",
    mask_values: Annotated[List[int], Query(
        description="Values in mask_layer to exclude. Repeat for each value."
    )] = [],
):
    if pixel_selection == "ndvi_best":
        scoring_assets = assets + [b for b in [nir_band, red_band] if b not in assets]
    else:
        scoring_assets = assets

    def get_method():
        if pixel_selection == "ndvi_best":
            return NDVIBestMethod(n_display_bands=len(assets))
        return PIXEL_SELECTION_METHODS[pixel_selection]()

    def read_tile(item_url: str):
        signed = sign_item(item_url)
        with STACReader(None, item=signed) as stac:
            img = stac.tile(x, y, z, assets=scoring_assets)

            if mask_layer and mask_values:
                try:
                    mask = stac.tile(x, y, z, assets=[mask_layer])
                    invalid = np.isin(mask.data[0], mask_values)
                    # mask all bands at invalid pixels
                    img.array.mask[:, invalid] = True
                except Exception:
                    # if mask layer isn't available for this item, skip silently
                    pass

            return img

    image, _ = mosaic_reader(items, read_tile, pixel_selection=get_method())

    rescale_min, rescale_max = map(float, rescale.split(","))
    image.rescale(in_range=[(rescale_min, rescale_max)], out_range=[(0, 255)])

    content = image.render(img_format="PNG")
    return Response(content=content, media_type="image/png",
                    headers={"Cache-Control": "public, max-age=3600"})


@app.get("/healthz")
async def health():
    return {"status": "ok"}

class NDVIBestMethod(MosaicMethodBase):
    def __init__(self, n_display_bands: int):
        super().__init__()
        self.n_display_bands = n_display_bands
        self._best_score = None

    def _ndvi(self, array):
        nir = array[-2].astype(float)
        red = array[-1].astype(float)
        return np.where((nir + red) == 0, -1, (nir - red) / (nir + red))

    def feed(self, array):
        score = self._ndvi(array)
        if self.mosaic is None:
            self.mosaic = array
            self._best_score = score
        else:
            better = score > self._best_score
            self.mosaic[:, better] = array[:, better]
            self._best_score = np.maximum(self._best_score, score)

    @property
    def data(self):
        return self.mosaic[:self.n_display_bands]