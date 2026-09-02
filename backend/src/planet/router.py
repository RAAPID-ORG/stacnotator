import logging
from collections.abc import Callable

import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPBearer
from sqlalchemy.orm import Session

from src.auth.dependencies import require_authenticated_user
from src.auth.models import User
from src.crypto import DecryptionError, decrypt
from src.database import get_db, release
from src.planet import client, scenes, tiles
from src.planet.schemas import (
    PlanetCredentials,
    PlanetScenePeriodOut,
    PlanetScenePlan,
    PlanetSceneWindowOut,
    PlanetSeriesMosaicsOut,
    PlanetSeriesOut,
)
from src.projects.dependencies import require_project_access

logger = logging.getLogger(__name__)
bearer = HTTPBearer()
router = APIRouter(
    prefix="/planet",
    tags=["Planet Basemaps"],
    dependencies=[Depends(bearer), Depends(require_authenticated_user)],
)


def _api_key(credentials: PlanetCredentials, db: Session, user: User) -> str:
    """The Planet key to browse with, from wherever this person is getting it.

    Access to the project is checked either way: a pasted key still spends someone's
    license, and the wizard runs before any source exists to hang authorization on.
    """
    project = require_project_access(project_id=credentials.project_id, db=db, user=user)
    if credentials.api_key is not None:
        return credentials.api_key

    key = next(
        (k for k in project.organization.api_keys if k.id == credentials.organization_api_key_id),
        None,
    )
    if key is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Organization API key not found"
        )
    # Browsing with it would work - the client only ever talks to Planet's API host -
    # but every mosaic it turned up would then fail to render, since the proxy will not
    # send an unbound key anywhere. Better to say so here than one screen later.
    if not key.allowed_tile_host:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "This organization key has no tile host set. An organization admin "
                "needs to set it (tiles.planet.com for Planet) before it can be used."
            ),
        )
    try:
        return decrypt(key.encrypted_key)
    except DecryptionError as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Organization API key could not be read",
        ) from e


def _upstream[T](call: Callable[[], T], what: str) -> T:
    try:
        return call()
    except client.PlanetError as e:
        # Logged, not just returned: the browser shows this to one person, and the
        # next report of "it says 502" has to be answerable from the logs alone.
        logger.warning("Planet %s refused: %s", what, e)
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(e)) from e
    except httpx.HTTPError as e:
        logger.error("Planet %s failed: %s", what, e)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY, detail=f"Could not reach Planet to {what}"
        ) from e


@router.post("/series", response_model=list[PlanetSeriesOut])
def list_planet_series(
    credentials: PlanetCredentials,
    db: Session = Depends(get_db),
    user: User = Depends(require_authenticated_user),
):
    """Basemap series this Planet key can see - the temporal cadences on offer."""
    api_key = _api_key(credentials, db, user)
    # The key is the last thing needing a database; Planet is a network call
    # away, and a connection held across it sits idle in a transaction until
    # Postgres ends it at DB_IDLE_IN_TRANSACTION_TIMEOUT_MS.
    release(db)
    series = _upstream(lambda: client.list_series(api_key), "list basemap series")
    return [
        PlanetSeriesOut(
            id=str(s.get("id", "")), name=str(s.get("name", "")), description=s.get("description")
        )
        for s in series
        if s.get("id")
    ]


@router.post("/series/{series_id}/mosaics", response_model=PlanetSeriesMosaicsOut)
def list_planet_series_mosaics(
    series_id: str,
    credentials: PlanetCredentials,
    db: Session = Depends(get_db),
    user: User = Depends(require_authenticated_user),
):
    """Every mosaic in a series, with the tile templates each one can be rendered by.

    This is the temporal structure that STAC search cannot supply: one mosaic per
    period, already ordered, each becoming a slice.
    """
    api_key = _api_key(credentials, db, user)
    # See list_planet_series.
    release(db)
    mosaics = _upstream(lambda: client.list_mosaics(series_id, api_key), "list series mosaics")
    return tiles.describe_series(series_id, mosaics)


def _period(group: scenes.SliceGroup) -> PlanetScenePeriodOut:
    return PlanetScenePeriodOut(
        start_date=group.period.start.isoformat(),
        end_date=group.period.end.isoformat(),
    )


@router.post("/scenes/plan", response_model=list[PlanetSceneWindowOut])
def plan_planet_scenes(
    request: PlanetScenePlan,
    db: Session = Depends(get_db),
    user: User = Depends(require_authenticated_user),
):
    """The windows and slices this config describes.

    Pure date arithmetic - Planet is not asked anything here. A scene source is not
    searched when it is set up: the area a search would be bounded by is wherever an
    annotator is standing, so it happens at annotation time instead.
    """
    require_project_access(project_id=request.project_id, db=db, user=user)
    return [
        PlanetSceneWindowOut(
            start_date=window.period.start.isoformat(),
            end_date=window.period.end.isoformat(),
            cover=_period(window.cover) if window.cover else None,
            slices=[_period(s) for s in window.slices],
        )
        for window in scenes.plan(request.config)
    ]
