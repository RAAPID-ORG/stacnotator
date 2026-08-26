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
from src.planet import client, tiles
from src.planet.schemas import PlanetCredentials, PlanetSeriesMosaicsOut, PlanetSeriesOut
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
