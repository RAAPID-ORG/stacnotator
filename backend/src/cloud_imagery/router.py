from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from src.auth.dependencies import require_authenticated_user
from src.auth.models import User
from src.cloud_imagery import service
from src.cloud_imagery.schemas import (
    CollectionCreate,
    CollectionList,
    CollectionOut,
    CollectionUpdate,
    DiscoverOut,
    ImportCreate,
    ImportOut,
)
from src.database import get_db

router = APIRouter(prefix="/cloud-imagery", tags=["cloud-imagery"])


@router.post("/collections", response_model=CollectionOut, status_code=status.HTTP_201_CREATED)
def create_collection(
    payload: CollectionCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_authenticated_user),
) -> CollectionOut:
    return service.create_collection(db, user, payload)


@router.get("/collections", response_model=CollectionList)
def list_collections(
    project_id: int = Query(gt=0),
    include_drafts: bool = Query(default=False),
    db: Session = Depends(get_db),
    user: User = Depends(require_authenticated_user),
) -> CollectionList:
    return CollectionList(
        items=service.list_collections(
            db, user, project_id=project_id, include_drafts=include_drafts
        )
    )


@router.get("/collections/{collection_id}", response_model=CollectionOut)
def get_collection(
    collection_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_authenticated_user),
) -> CollectionOut:
    return service.get_collection(db, user, collection_id)


@router.patch("/collections/{collection_id}", response_model=CollectionOut)
def update_collection(
    collection_id: int,
    payload: CollectionUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_authenticated_user),
) -> CollectionOut:
    return service.update_collection(db, user, collection_id, payload)


@router.delete("/collections/{collection_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_collection(
    collection_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_authenticated_user),
) -> None:
    service.delete_collection(db, user, collection_id)


@router.get("/collections/{collection_id}/discover", response_model=DiscoverOut)
def discover_objects(
    collection_id: int,
    cursor: str | None = Query(default=None, max_length=1024),
    limit: int = Query(default=200, ge=1, le=1000),
    db: Session = Depends(get_db),
    user: User = Depends(require_authenticated_user),
) -> DiscoverOut:
    return service.discover(db, user, collection_id, cursor, limit)


@router.post(
    "/collections/{collection_id}/imports",
    response_model=ImportOut,
    status_code=status.HTTP_202_ACCEPTED,
)
def start_import(
    collection_id: int,
    payload: ImportCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_authenticated_user),
) -> ImportOut:
    return service.start_import(db, user, collection_id, payload)


@router.get("/imports/{import_id}", response_model=ImportOut)
def get_import(
    import_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_authenticated_user),
) -> ImportOut:
    return service.get_import(db, user, import_id)


@router.post(
    "/imports/{import_id}/retry", response_model=ImportOut, status_code=status.HTTP_202_ACCEPTED
)
def retry_import(
    import_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_authenticated_user),
) -> ImportOut:
    return service.retry_import(db, user, import_id)
