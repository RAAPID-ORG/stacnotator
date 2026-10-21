"""Managed Azure cloud imagery catalogs: ownership, discovery and background imports.

A catalog is an Azure Blob container (and prefix) whose selected GeoTIFFs the tiler holds
as one pgstac collection (``cc-<32 hex>``). Imports run on ``src/background.py`` status
runs, fenced by ``attempt`` so a superseded run can never write over its retry. No
database connection is held across a storage or tiler call.
"""

import logging
import posixpath
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from urllib.parse import quote, urlparse

import httpx
from fastapi import HTTPException, status
from sqlalchemy import Update, func, select, text, update
from sqlalchemy.orm import Session

from src import storage_access
from src.auth.models import User
from src.background import StatusField, begin_status_run, fail_stale_status_runs, spawn_status_run
from src.cloud_imagery import azure
from src.cloud_imagery.models import CloudImageryCollection, CloudImageryFile, CloudImageryImport
from src.cloud_imagery.schemas import (
    CollectionCreate,
    CollectionOut,
    CollectionUpdate,
    DiscoveredObject,
    DiscoverOut,
    ImportCreate,
    ImportIssue,
    ImportOut,
)
from src.config import get_settings
from src.imagery.models import CollectionStacConfig
from src.organizations.models import OrganizationTiler
from src.projects.dependencies import assert_project_admin
from src.storage_access import Held
from src.tilers import catalogs, registry

logger = logging.getLogger(__name__)

IMPORT_RUN = StatusField(
    model=CloudImageryImport,
    status_column="status",
    heartbeat_column="heartbeat_at",
    errors_column="errors",
    interrupted_error="Indexing was interrupted; retry it to continue",
    attempt_column="attempt",
)

_TIFF_SUFFIXES = (".tif", ".tiff")
_ADMISSION_LOCK = 0x0C10D158


def _not_found() -> HTTPException:
    return HTTPException(status.HTTP_404_NOT_FOUND, "Cloud imagery collection not found")


# ── authorization ─────────────────────────────────────────────────────────────


def _may_manage(db: Session, user: User, row: CloudImageryCollection) -> bool:
    """Project admins and platform admins manage a catalog; everyone else gets a 404."""
    try:
        assert_project_admin(db, user, row.project_id)
    except HTTPException as exc:
        if exc.status_code != status.HTTP_403_FORBIDDEN:
            raise
        return False
    return True


def _managed(db: Session, user: User, collection_id: int) -> CloudImageryCollection:
    row = db.get(CloudImageryCollection, collection_id)
    if row is None or not _may_manage(db, user, row):
        raise _not_found()
    return row


# ── views ─────────────────────────────────────────────────────────────────────


def _status(row: CloudImageryCollection) -> str:
    run = row.run
    if run is None or run.status is None:
        return "draft"
    return {"registering": "importing"}.get(run.status, run.status)


def collection_out(row: CloudImageryCollection) -> CollectionOut:
    tiler = registry.get(row.tiler)
    return CollectionOut(
        id=row.id,
        title=row.title,
        project_id=row.project_id,
        status=_status(row),
        tiler=row.tiler,
        container_url=row.container_url,
        prefix=row.prefix,
        storage_access=storage_access.described(row),
        data_region=row.data_region,
        tiler_region=tiler.region if tiler is not None else None,
        visualizations=list(row.visualizations or []),
        bbox=row.bbox,
        interval=row.interval,
        item_count=row.item_count,
        import_id=row.run.id if row.run is not None else None,
    )


def _issue(entry: dict) -> ImportIssue:
    if "code" in entry:
        return ImportIssue(code=entry["code"], path=entry.get("path"), message=entry["message"])
    return ImportIssue(code="import_failed", path=None, message=str(entry.get("error", "")))


def import_out(db: Session, run: CloudImageryImport) -> ImportOut:
    total, completed = db.execute(
        select(func.count(), func.count(CloudImageryFile.item_id)).where(
            CloudImageryFile.import_id == run.id
        )
    ).one()
    current = run.status or "registering"
    return ImportOut(
        id=run.id,
        collection_id=run.collection_id,
        status=current,
        total=total,
        completed=completed,
        errors=[_issue(e) for e in run.errors or []],
        retryable=current == "failed",
    )


# ── catalogs ──────────────────────────────────────────────────────────────────


def _container(url: str) -> str:
    try:
        storage_access.check_url(url)
    except storage_access.InvalidStorageAccess as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)) from exc
    parsed = urlparse(url)
    segments = [s for s in parsed.path.split("/") if s]
    if (
        len(segments) != 1
        or parsed.query
        or parsed.fragment
        or parsed.port
        or parsed.username
        or parsed.password
    ):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "Give the container URL itself: https://<account>.blob.core.windows.net/<container>",
        )
    return f"https://{parsed.hostname}/{segments[0]}"


def _prefix(prefix: str) -> str:
    cleaned = prefix.strip().lstrip("/")
    if not cleaned:
        return ""
    parts = cleaned.rstrip("/").split("/")
    if any(p in ("", ".", "..") for p in parts) or any(c in cleaned for c in "?#\\"):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "The prefix is not a folder path")
    return "/".join(parts) + "/"


def create_collection(db: Session, user: User, payload: CollectionCreate) -> CollectionOut:
    project = assert_project_admin(db, user, payload.project_id)
    tiler = registry.get(payload.tiler)
    on_list = db.scalar(
        select(OrganizationTiler.tiler_name).where(
            OrganizationTiler.organization_id == project.organization_id,
            OrganizationTiler.tiler_name == payload.tiler,
        )
    )
    if tiler is None or tiler.kind != registry.HOSTED or on_list is None:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, "This tiler is not available to the organization"
        )
    row = CloudImageryCollection(
        title=payload.title,
        project_id=payload.project_id,
        tiler=payload.tiler,
        stac_collection_id=f"cc-{uuid.uuid4().hex}",
        container_url=_container(payload.container_url),
        prefix=_prefix(payload.prefix),
        data_region=payload.data_region,
        visualizations=[v.model_dump(mode="json") for v in payload.visualizations],
    )
    storage_access.store(row, payload.storage_access)
    db.add(row)
    db.commit()
    db.refresh(row)
    return collection_out(row)


def list_collections(
    db: Session, user: User, *, project_id: int, include_drafts: bool
) -> list[CollectionOut]:
    """The project's READY campaign picker, or with ``include_drafts`` every catalog of
    the project whatever its status."""
    assert_project_admin(db, user, project_id)
    stmt = select(CloudImageryCollection).where(CloudImageryCollection.project_id == project_id)
    if not include_drafts:
        stmt = stmt.join(
            CloudImageryImport, CloudImageryImport.collection_id == CloudImageryCollection.id
        ).where(CloudImageryImport.status == "ready")
    rows = db.scalars(stmt.order_by(CloudImageryCollection.title, CloudImageryCollection.id))
    return [collection_out(r) for r in rows]


def get_collection(db: Session, user: User, collection_id: int) -> CollectionOut:
    return collection_out(_managed(db, user, collection_id))


def _used_by_imagery(db: Session, row: CloudImageryCollection) -> bool:
    return (
        db.scalar(
            select(CollectionStacConfig.collection_id)
            .where(CollectionStacConfig.cloud_collection_id == row.id)
            .limit(1)
        )
        is not None
    )


def update_collection(
    db: Session, user: User, collection_id: int, payload: CollectionUpdate
) -> CollectionOut:
    row = _managed(db, user, collection_id)
    if payload.storage_access is not None and _used_by_imagery(db, row):
        # Imagery registered from this catalog holds its own copy of the access, sealed
        # into its tiler searches; a new access would leave those reading with the old one.
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Campaign imagery uses this collection; remove it there before replacing the access",
        )
    if payload.title is not None:
        row.title = payload.title
    if payload.visualizations is not None:
        row.visualizations = [v.model_dump(mode="json") for v in payload.visualizations]
    storage_access.store(row, payload.storage_access)
    db.commit()
    db.refresh(row)
    return collection_out(row)


def delete_collection(db: Session, user: User, collection_id: int) -> None:
    row = _managed(db, user, collection_id)
    if row.run is not None and row.run.status == "registering":
        raise HTTPException(status.HTTP_409_CONFLICT, "Indexing is running for this collection")
    if _used_by_imagery(db, row):
        raise HTTPException(status.HTTP_409_CONFLICT, "Campaign imagery still uses this collection")
    tiler, cid = row.tiler, row.stac_collection_id
    has_import = row.run is not None
    db.commit()
    try:
        if has_import:
            catalogs.delete(tiler, cid)
    except catalogs.CatalogError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(exc)) from exc
    db.delete(db.get(CloudImageryCollection, collection_id))
    db.commit()


def discover(
    db: Session, user: User, collection_id: int, cursor: str | None, limit: int
) -> DiscoverOut:
    row = _managed(db, user, collection_id)
    access = storage_access.stored(row)
    container_url, prefix = row.container_url, row.prefix
    db.commit()
    if access is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "The collection has no storage access")
    try:
        page = azure.list_blobs(
            container_url, access.secret, prefix=prefix, marker=cursor, max_results=limit
        )
    except (httpx.HTTPError, ValueError) as exc:
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY, "Azure Blob Storage could not list the container"
        ) from exc
    objects = [
        DiscoveredObject(path=b.path, etag=b.etag, size=b.size)
        for b in page.blobs
        if b.path.lower().endswith(_TIFF_SUFFIXES)
    ]
    return DiscoverOut(objects=objects, next_cursor=page.next_marker)


# ── managed reference for campaign imagery ────────────────────────────────────


@dataclass(frozen=True)
class ManagedCollection:
    id: int
    title: str
    tiler: str
    stac_collection_id: str
    container_url: str
    storage_access: dict
    held_access: Held


def resolve_managed_collection(db: Session, project_id: int, collection_id: int):
    """A ready catalog of that project, resolved server-side so no client can name a
    catalog URL, collection, tiler or access."""
    row = db.get(CloudImageryCollection, collection_id)
    if row is None or row.project_id != project_id:
        raise _not_found()
    access, held = storage_access.stored(row), storage_access.held(row)
    if _status(row) != "ready" or access is None or held is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "This cloud imagery collection is not ready")
    return ManagedCollection(
        id=row.id,
        title=row.title,
        tiler=row.tiler,
        stac_collection_id=row.stac_collection_id,
        container_url=row.container_url,
        storage_access=storage_access.seal_for_tiler(access, row.container_url),
        held_access=held,
    )


# ── imports ───────────────────────────────────────────────────────────────────


def _scoped_path(prefix: str, path: str) -> str:
    normalized = posixpath.normpath(path)
    if (
        normalized != path
        or path.startswith("/")
        or any(c in path for c in "?#\\")
        or ".." in path.split("/")
        or not path.startswith(prefix)
        or not path.lower().endswith(_TIFF_SUFFIXES)
    ):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            f"{path!r} is not a GeoTIFF inside the collection's folder",
        )
    return path


def _require_capability(tiler: str) -> None:
    try:
        catalogs.capabilities(tiler)
    except catalogs.CatalogError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc


def _admit(db: Session, collection_id: int) -> CloudImageryImport | None:
    """Serialize admission DB-wide, then enforce one run per collection and the global cap.
    Returns the collection's run as it stands under the lock; the caller commits, which
    releases the lock."""
    db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": _ADMISSION_LOCK})
    fail_stale_status_runs(db, (IMPORT_RUN,))
    db.expire_all()
    run = db.scalar(
        select(CloudImageryImport).where(CloudImageryImport.collection_id == collection_id)
    )
    if run is not None and run.status == "registering":
        raise HTTPException(status.HTTP_409_CONFLICT, "Indexing is already running")
    live = db.scalar(
        select(func.count())
        .select_from(CloudImageryImport)
        .where(CloudImageryImport.status == "registering")
    )
    if (live or 0) >= get_settings().CLOUD_IMPORT_MAX_CONCURRENT:
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "Too many indexing jobs are running; try again shortly",
        )
    return run


def start_import(db: Session, user: User, collection_id: int, payload: ImportCreate) -> ImportOut:
    row = _managed(db, user, collection_id)
    paths = [_scoped_path(row.prefix, f.path) for f in payload.files]
    tiler = row.tiler
    db.commit()
    _require_capability(tiler)
    row = _managed(db, user, collection_id)
    run = _admit(db, row.id)
    if run is not None and run.status == "ready":
        raise HTTPException(status.HTTP_409_CONFLICT, "This collection is already indexed")
    stale_cid = None
    if run is None:
        run = CloudImageryImport(collection_id=row.id, attempt=1, errors=[])
        db.add(run)
    else:
        # A new manifest goes into a fresh pgstac collection, so a late batch of an earlier
        # attempt can only land in the old one, which is dropped once this import is done.
        stale_cid = row.stac_collection_id
        row.stac_collection_id = f"cc-{uuid.uuid4().hex}"
        run.attempt += 1
        run.errors = []
        run.reset_pending = True
        for old in list(run.files):
            db.delete(old)
        db.flush()
    for path, selection in zip(paths, payload.files, strict=True):
        start, end = selection.span()
        run.files.append(
            CloudImageryFile(
                path=path,
                etag=selection.etag,
                instant=selection.instant,
                start_datetime=start,
                end_datetime=end,
            )
        )
    return _launch(db, run, stale_cid)


def _launch(db: Session, run: CloudImageryImport, stale_cid: str | None = None) -> ImportOut:
    begin_status_run(run, IMPORT_RUN)
    db.commit()
    db.refresh(run)
    run_id, attempt = run.id, run.attempt
    accepted = import_out(db, run)
    db.commit()
    spawn_status_run(
        run_id,
        IMPORT_RUN,
        name="cloud imagery import",
        work=lambda session: _import_work(session, run_id, attempt, stale_cid),
        sanitize_error=lambda exc: "Indexing failed unexpectedly; retry it",
        attempt=attempt,
    )
    return accepted


def _run_for(db: Session, user: User, import_id: int) -> CloudImageryImport:
    run = db.get(CloudImageryImport, import_id)
    if run is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Indexing job not found")
    _managed(db, user, run.collection_id)
    return run


def get_import(db: Session, user: User, import_id: int) -> ImportOut:
    run = _run_for(db, user, import_id)
    if fail_stale_status_runs(db, (IMPORT_RUN,), row_id=import_id):
        db.commit()
        db.refresh(run)
    return import_out(db, run)


def retry_import(db: Session, user: User, import_id: int) -> ImportOut:
    run = _run_for(db, user, import_id)
    fail_stale_status_runs(db, (IMPORT_RUN,), row_id=import_id)
    db.commit()
    db.refresh(run)
    if run.status != "failed":
        raise HTTPException(status.HTTP_409_CONFLICT, "Only a failed indexing job can be retried")
    tiler = run.collection.tiler
    db.commit()
    _require_capability(tiler)
    admitted = _admit(db, _run_for(db, user, import_id).collection_id)
    if admitted is None or admitted.status != "failed":
        raise HTTPException(status.HTTP_409_CONFLICT, "Only a failed indexing job can be retried")
    run = admitted
    run.attempt += 1
    run.errors = []
    return _launch(db, run)


# ── the background import ────────────────────────────────────────────────────


@dataclass(frozen=True)
class _Pending:
    file_id: int
    path: str
    etag: str
    instant: bool
    start: datetime
    end: datetime
    item_id: str | None


def _iso(value: datetime) -> str:
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")


def _strip(etag: str) -> str:
    return etag.strip().strip('"')


def _fenced(db: Session, stmt: Update, run_id: int, attempt: int) -> bool:
    """Run a write only while ``attempt`` is still the run's current attempt."""
    current = (
        select(CloudImageryImport.id)
        .where(
            CloudImageryImport.id == run_id,
            CloudImageryImport.attempt == attempt,
            CloudImageryImport.status == "registering",
        )
        .exists()
    )
    result = db.execute(stmt.where(current).execution_options(synchronize_session=False))
    db.commit()
    return bool(getattr(result, "rowcount", 0))


def _import_work(
    db: Session, run_id: int, attempt: int, stale_cid: str | None = None
) -> list[dict]:
    run = db.get(CloudImageryImport, run_id)
    if run is None:
        return []
    row = run.collection
    title, tiler, cid = row.title, row.tiler, row.stac_collection_id
    container_url, collection_id = row.container_url, row.id
    access = storage_access.stored(row)
    files = [
        _Pending(f.id, f.path, f.etag, f.instant, f.start_datetime, f.end_datetime, f.item_id)
        for f in run.files
    ]
    db.commit()
    if access is None:
        return [{"code": "no_access", "path": None, "message": "The storage access is missing"}]
    try:
        limit = int(catalogs.capabilities(tiler).get("max_batch_items", 100))
        batch_size = max(1, min(get_settings().CLOUD_IMPORT_BATCH_SIZE, limit))
        problems = _check_objects(container_url, access.secret, files)
        if problems:
            return problems
        sealed = storage_access.seal_for_tiler(access, container_url)
        pending = [f for f in files if f.item_id is None]
        item_ids = {f.file_id: f.item_id for f in files if f.item_id is not None}
        for start in range(0, len(pending), batch_size):
            batch = pending[start : start + batch_size]
            returned = _send_batch(tiler, cid, title, container_url, sealed, batch)
            for f in batch:
                if not _fenced(
                    db,
                    update(CloudImageryFile)
                    .where(CloudImageryFile.id == f.file_id)
                    .values(item_id=returned[f.file_id]),
                    run_id,
                    attempt,
                ):
                    return []
            item_ids.update(returned)
        summary = catalogs.verify(tiler, cid, sorted(item_ids.values()), title)
    except catalogs.ObjectRejected as exc:
        originals = {_href(container_url, f.path): f.path for f in files}
        path = originals.get(exc.href or "")
        return [{"code": exc.code, "path": path, "message": str(exc) or "Unusable object"}]
    except catalogs.CatalogError as exc:
        return [{"code": "tiler_error", "path": None, "message": str(exc)}]
    if summary.get("item_count") != len(item_ids):
        return [
            {
                "code": "verification_failed",
                "path": None,
                "message": "The tiler holds a different number of items than were indexed",
            }
        ]
    if not _fenced(
        db,
        update(CloudImageryCollection)
        .where(CloudImageryCollection.id == collection_id)
        .values(
            bbox=summary.get("bbox"),
            interval=summary.get("interval"),
            item_count=summary["item_count"],
        ),
        run_id,
        attempt,
    ):
        return []
    if stale_cid is not None:
        _drop_stale_collection(db, tiler, stale_cid, run_id, attempt)
    return []


def _drop_stale_collection(
    db: Session, tiler: str, stale_cid: str, run_id: int, attempt: int
) -> None:
    """Delete the collection a replaced manifest was imported into. On failure the run keeps
    ``reset_pending`` so the leftover collection stays visible as pending cleanup."""
    try:
        catalogs.delete(tiler, stale_cid)
    except catalogs.CatalogError:
        logger.warning("Could not delete the replaced catalog collection %s", stale_cid)
        return
    _fenced(
        db,
        update(CloudImageryImport)
        .where(CloudImageryImport.id == run_id)
        .values(reset_pending=False),
        run_id,
        attempt,
    )


def _check_objects(container_url: str, sas: str, files: list[_Pending]) -> list[dict]:
    problems = []
    for f in files:
        try:
            blob = azure.get_blob(container_url, sas, f.path)
        except httpx.HTTPError:
            problems.append(
                {"code": "storage_error", "path": f.path, "message": "The object could not be read"}
            )
            continue
        if blob is None:
            problems.append(
                {"code": "object_missing", "path": f.path, "message": "The object no longer exists"}
            )
        elif _strip(blob.etag) != _strip(f.etag):
            problems.append(
                {
                    "code": "object_changed",
                    "path": f.path,
                    "message": "The object changed since it was selected; select it again",
                }
            )
    return problems


def _href(container_url: str, path: str) -> str:
    """The object's URL with its blob key percent-encoded exactly once."""
    return f"{container_url}/{quote(path, safe='/')}"


def _send_batch(
    tiler: str, cid: str, title: str, container_url: str, sealed: dict, batch: list[_Pending]
) -> dict[int, str]:
    by_href = {_href(container_url, f.path): f for f in batch}
    items = []
    for href, f in by_href.items():
        if f.instant:
            items.append({"href": href, "datetime": _iso(f.start)})
        else:
            items.append(
                {"href": href, "start_datetime": _iso(f.start), "end_datetime": _iso(f.end)}
            )
    body = {
        "title": title,
        "container_url": container_url,
        "storage_access": sealed,
        "items": items,
    }
    returned = catalogs.put_batch(tiler, cid, body)
    ids: dict[int, str] = {}
    for item in returned:
        sent = by_href.get(item.get("href", ""))
        if sent is None or sent.file_id in ids or not item.get("id"):
            raise catalogs.CatalogError("The tiler answered a batch with unexpected items")
        ids[sent.file_id] = str(item["id"])
    if len(ids) != len(batch):
        raise catalogs.CatalogError("The tiler did not register every object in a batch")
    return ids
