import logging
import time
from collections.abc import Collection

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.security import HTTPBearer
from sqlalchemy.orm import Session

from src.auth.dependencies import require_authenticated_user
from src.auth.models import User
from src.database import get_db
from src.projects.dependencies import require_project_access
from src.projects.models import Project
from src.stac_browser.catalogs import (
    COLLECTIONS_CACHE_TTL,
    _cache_get,
    _cache_set,
    assert_catalog_url_safe,
    public_catalogs,
)
from src.stac_browser.client import list_collections as _list_collections
from src.stac_browser.client import search_items
from src.stac_browser.schemas import (
    SearchRequest,
    SearchResponse,
    StacCatalogOut,
    StacCollectionOut,
)
from src.tilers import registry

logger = logging.getLogger(__name__)
bearer = HTTPBearer()
router = APIRouter(
    prefix="/stac",
    tags=["STAC Browser"],
    dependencies=[Depends(bearer), Depends(require_authenticated_user)],
)


@router.get("/catalogs", response_model=list[StacCatalogOut])
async def list_catalogs(
    project_id: int = Query(..., description="Project the wizard is configuring imagery for"),
    db: Session = Depends(get_db),
    user: User = Depends(require_authenticated_user),
):
    """Browsable catalogs: the project organization's platform tiler catalogs first, then
    public ones (MPC + StacIndex). Platform catalogs carry ``tiler_name`` so the wizard
    auto-targets the tiler; others route to the default tiler."""
    project = require_project_access(project_id=project_id, db=db, user=user)
    return [
        *_tiler_catalogs(project.organization.allowed_tiler_names),
        *await public_catalogs(),
    ]


def _tiler_catalogs(allowed_tiler_names: Collection[str]) -> list[dict]:
    """Platform tiler catalogs the organization may use. Excludes MPC (a public catalog
    below)."""
    allowed = set(allowed_tiler_names)
    out = []
    for tiler in registry.browsable_tilers():
        if tiler.kind == registry.MPC or tiler.name not in allowed:
            continue
        out.append(
            {
                "id": f"tiler-{tiler.name}",
                "title": tiler.title or tiler.name,
                "url": tiler.stac_url,
                "summary": tiler.title or f"Imagery served by the {tiler.name} tiler",
                "is_mpc": False,
                "auth_required": False,
                "tiler_name": tiler.name,
                "provided": True,
            }
        )
    return out


def _authorize_catalog(catalog_url: str, project: Project) -> None:
    """A platform tiler's STAC API is scoped to the organizations allowed that tiler,
    exactly as ``/stac/catalogs`` lists it. Public catalogs stay browsable by anyone."""
    tiler = registry.tiler_of_catalog(catalog_url)
    if tiler is None or tiler.name in project.organization.allowed_tiler_names:
        return
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail=f"Your organization is not authorized to use tiler '{tiler.name}'",
    )


@router.get("/collections", response_model=list[StacCollectionOut])
def get_collections(
    catalog_url: str = Query(..., description="STAC API URL"),
    project_id: int = Query(..., description="Project the wizard is configuring imagery for"),
    db: Session = Depends(get_db),
    user: User = Depends(require_authenticated_user),
):
    """List collections from a STAC API catalog, with a 1h cache.

    Serves stale data on upstream failure so a transient MPC timeout
    doesn't block the user.
    """
    _authorize_catalog(catalog_url, require_project_access(project_id=project_id, db=db, user=user))
    assert_catalog_url_safe(catalog_url)
    now = time.time()
    entry = _cache_get(catalog_url)
    if entry and now < entry["expires"]:
        age = now - (entry["expires"] - COLLECTIONS_CACHE_TTL)
        logger.info(
            "collections cache HIT catalog=%s count=%d age=%.1fs",
            catalog_url,
            len(entry["data"]),
            age,
        )
        return entry["data"]

    logger.info("collections cache MISS catalog=%s - fetching upstream", catalog_url)
    t0 = time.time()
    try:
        data = _list_collections(catalog_url)
    except Exception as e:
        elapsed = time.time() - t0
        logger.error(
            "collections fetch FAILED catalog=%s elapsed=%.2fs err=%s",
            catalog_url,
            elapsed,
            e,
        )
        if entry and entry.get("data"):
            logger.warning("Serving stale collections cache for %s", catalog_url)
            return entry["data"]
        raise HTTPException(status_code=502, detail="Failed to connect to catalog") from e

    elapsed = time.time() - t0
    logger.info(
        "collections fetch OK catalog=%s count=%d elapsed=%.2fs",
        catalog_url,
        len(data),
        elapsed,
    )
    _cache_set(catalog_url, {"data": data, "expires": now + COLLECTIONS_CACHE_TTL})
    return data


@router.post("/search", response_model=SearchResponse)
def search(
    request: SearchRequest,
    project_id: int = Query(..., description="Project the wizard is configuring imagery for"),
    db: Session = Depends(get_db),
    user: User = Depends(require_authenticated_user),
):
    """Search STAC items in a catalog collection."""
    _authorize_catalog(
        request.catalog_url, require_project_access(project_id=project_id, db=db, user=user)
    )
    assert_catalog_url_safe(request.catalog_url)
    try:
        items, next_offset = search_items(
            catalog_url=request.catalog_url,
            collection_id=request.collection_id,
            bbox=request.bbox,
            datetime_range=request.datetime_range,
            limit=request.limit,
            offset=request.offset,
        )
        return {"items": items, "count": len(items), "next_offset": next_offset}
    except Exception as e:
        logger.error("STAC search failed: %s", e)
        raise HTTPException(status_code=502, detail="Search failed") from e
