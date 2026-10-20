"""Specification: reusable Azure cloud imagery catalogs (issue #158), over real HTTP + Postgres.

Strategy: the real FastAPI app, real authorization dependencies and a real throwaway
PostGIS database (created per module on the configured server; run inside the backend
container, where DBHOST reaches Postgres). Only external seams are faked: Azure Blob
(``src.cloud_imagery.azure``) and the companion tiler (module-level ``httpx.get/post/
delete``, the mechanism ``src/tilers/providers.py`` already uses). Imports run on the
existing ``src/background.py`` status runs; the tests poll exactly like the UI does.

Core contract (all under /api/cloud-imagery; errors use the app's {"detail": ...} shape):
  POST /collections  {"title", "owner": {"project_id": int} | {"organization_id": int},
        "tiler": str, "container_url": "https://<acct>.blob.core.windows.net/<container>",
        "prefix": str, "storage_access": {"kind": "azure_sas", "secret": str},
        "data_region": str | null}
     -> 201 CollectionOut {"id", "title", "owner", "status": "draft"|"importing"|"ready"|
        "failed", "tiler", "container_url", "prefix", "storage_access": {"kind",
        "expires_at"}, "data_region", "tiler_region"}   (never the secret)
     project owner: project admin or platform admin; organization owner: org admin or
     platform admin; the tiler must be on the organization's allow-list.
  GET  /collections?project_id=P -> {"items": [CollectionOut]}: READY catalogs owned by P
     or by P's organization. GET /collections/{id} -> 404 outside the caller's scopes.
  GET  /collections/{id}/discover?cursor=&limit= -> {"objects": [{"path", "etag", "size"}],
     "next_cursor": str | null}; .tif/.tiff only, paths relative to the container.
  POST /collections/{id}/imports {"files": [{"path", "etag", "datetime"} |
        {"path", "etag", "start_datetime", "end_datetime"}]}   (date-only => UTC day bounds)
     -> 202 ImportOut {"id", "collection_id", "status": "registering"|"ready"|"failed",
        "total", "completed", "errors": [{"code", "path", "message"}], "retryable"}
     422 invalid input; 409 import already running for the collection, or the tiler lacks
     the catalog capability; 429 when CLOUD_IMPORT_MAX_CONCURRENT runs are live (counted
     in the DB, so the bound holds across web processes).
  GET  /imports/{id} -> ImportOut (polling also fails runs whose heartbeat went stale)
  POST /imports/{id}/retry -> 202 ImportOut (failed runs only, else 409); resends only
     files not yet checkpointed; a superseded attempt can never write status again.
Tiler calls (see tiler tests/test_catalogs.py): GET /catalogs/capabilities, POST
/catalogs/{cc-<32 hex>}/batches {"title", "container_url", "storage_access": sealed,
"items": [{"href", time}]}, POST .../verify {"item_ids"}; Bearer token scope
"catalogs:write"; hrefs are raw (no query) inside the container.
Seams: ``src.cloud_imagery.azure`` defines dataclasses ``Blob(path, etag, size)`` and
``BlobPage(blobs, next_marker)``, plus ``list_blobs(container_url, sas, *, prefix, marker,
max_results) -> BlobPage`` and ``get_blob(container_url, sas, path) -> Blob | None``,
called through the module attribute. Model ``src.cloud_imagery.models.CloudImageryImport``
has ``status`` and ``heartbeat_at`` columns. Settings (env): CLOUD_IMPORT_MAX_CONCURRENT,
CLOUD_IMPORT_BATCH_SIZE (sent batch = min(this, tiler max_batch_items)).
Helper: ``src.cloud_imagery.service.resolve_managed_collection(db, project_id, id)`` ->
object with ``tiler``, ``stac_collection_id``, ``storage_access`` (sealed for the tiler);
raises HTTPException 404 (outside the project's scopes) or 409 (not ready).
"""

import dataclasses
import hashlib
import json
import re
import threading
import time
import uuid
from urllib.parse import quote

import httpx
import pytest
from fastapi import Depends, HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import OperationalError

from src.auth.dependencies import require_authenticated_user
from src.auth.models import User
from src.config import get_settings
from src.database import Base, SessionLocal, get_db
from src.organizations.models import Organization, OrganizationTiler, OrganizationUser
from src.projects.models import Project, ProjectUser

HOST = "acct.blob.core.windows.net"
CONTAINER = f"https://{HOST}/imagery"
SECRET = "sp=rl&se=2099-01-01T00:00:00Z&spr=https&sv=2022-11-02&sr=c&sig=TOPSECRET"
TILER_URL = "https://tiler.test"
CATALOG_PATH = re.compile(r"^/catalogs/(cc-[0-9a-f]{32})/(batches|verify)$")


def _item_id(href: str) -> str:
    return "it-" + hashlib.sha1(href.encode(), usedforsecurity=False).hexdigest()[:12]


# ── infrastructure: throwaway PostGIS database ─────────────────────────────────


@pytest.fixture(scope="module")
def database():
    base = make_url(get_settings().DATABASE_URL)
    import src.cloud_imagery.models  # noqa: F401  (registers the new tables)

    admin = create_engine(base.set(database="postgres"), isolation_level="AUTOCOMMIT")
    try:
        admin.connect().close()
    except OperationalError:
        pytest.skip("needs Postgres: run inside the backend container (DBHOST=db)")
    name = f"cloud_catalog_test_{uuid.uuid4().hex[:8]}"
    with admin.connect() as conn:
        conn.execute(text(f'CREATE DATABASE "{name}"'))
    engine = create_engine(base.set(database=name))
    with engine.begin() as conn:
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS postgis"))
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
        for schema in {t.schema for t in Base.metadata.tables.values() if t.schema}:
            conn.execute(text(f'CREATE SCHEMA IF NOT EXISTS "{schema}"'))
    Base.metadata.create_all(engine)
    original = SessionLocal.kw["bind"]
    SessionLocal.configure(bind=engine)
    yield engine
    SessionLocal.configure(bind=original)
    engine.dispose()
    with admin.connect() as conn:
        conn.execute(text(f'DROP DATABASE "{name}" WITH (FORCE)'))


@pytest.fixture()
def settings_env(monkeypatch):
    monkeypatch.setenv("TILERS", json.dumps({"hosted": {"url": TILER_URL}}))
    monkeypatch.setenv("DEFAULT_TILER", "hosted")
    monkeypatch.setenv("CLOUD_IMPORT_MAX_CONCURRENT", "1")
    monkeypatch.setenv("CLOUD_IMPORT_BATCH_SIZE", "2")
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


# ── external fakes ─────────────────────────────────────────────────────────────


class FakeAzure:
    def __init__(self, azure):
        self.mod = azure
        paths = ["flights/a.tif", "flights/b.tif", "flights/c.tiff", "flights/readme.txt"]
        self.blobs = {
            p: azure.Blob(path=p, etag=f'"0x{i}"', size=1000 + i) for i, p in enumerate(paths)
        }

    def list_blobs(self, container_url, sas, *, prefix, marker, max_results):
        assert container_url == CONTAINER and "sig=TOPSECRET" in sas
        names = sorted(p for p in self.blobs if p.startswith(prefix))
        start = int(marker or 0)
        nxt = str(start + max_results) if start + max_results < len(names) else None
        page = [self.blobs[p] for p in names[start : start + max_results]]
        return self.mod.BlobPage(blobs=page, next_marker=nxt)

    def get_blob(self, container_url, sas, path):
        return self.blobs.get(path)


class FakeTiler:
    """The companion tiler's /catalogs contract."""

    def __init__(self):
        self.batches: list[list[str]] = []
        self.verified: list[list[str]] = []
        self.fail_once: set[str] = set()
        self.reject: dict[str, str] = {}
        self.capable = True
        self.hold = None  # (entered, release): the next batch call blocks until released
        self.hold_status = 200

    @staticmethod
    def _auth(headers):
        from src.tilers.tokens import verify

        claims = verify(headers["Authorization"].removeprefix("Bearer "))
        assert "catalogs:write" in claims["scope"]

    def get(self, url, headers=None, **kw):
        self._auth(headers)
        req = httpx.Request("GET", url)
        assert url == f"{TILER_URL}/catalogs/capabilities"
        if not self.capable:
            return httpx.Response(404, json={"detail": "Not Found"}, request=req)
        body = {"version": 1, "providers": ["azure_blob"], "max_batch_items": 50}
        return httpx.Response(200, json=body, request=req)

    def post(self, url, json=None, headers=None, **kw):
        self._auth(headers)
        req = httpx.Request("POST", url)
        match = CATALOG_PATH.match(url.removeprefix(TILER_URL))
        assert match, url
        if match[2] == "verify":
            self.verified.append(sorted(json["item_ids"]))
            body = {
                "item_count": len(json["item_ids"]),
                "bbox": [10, 49, 11, 50],
                "interval": ["2026-01-01T00:00:00Z", "2026-01-31T23:59:59.999999Z"],
            }
            return httpx.Response(200, json=body, request=req)
        assert "TOPSECRET" not in str(json)
        assert json["storage_access"]["host"] == HOST and json["container_url"] == CONTAINER
        hrefs = [i["href"] for i in json["items"]]
        assert all(h.startswith(CONTAINER + "/") and "?" not in h for h in hrefs)
        if self.hold is not None:
            (entered, release), self.hold = self.hold, None
            entered.set()
            release.wait(20)
            return httpx.Response(self.hold_status, json={"detail": "late"}, request=req)
        self.batches.append(hrefs)
        for h in hrefs:
            if h in self.reject:
                detail = {"code": self.reject[h], "href": h, "message": "raster has no CRS"}
                return httpx.Response(422, json={"detail": detail}, request=req)
        if set(hrefs) & self.fail_once:
            self.fail_once.clear()
            return httpx.Response(503, json={"detail": "busy"}, request=req)
        items = [{"id": _item_id(h), "href": h} for h in hrefs]
        return httpx.Response(200, json={"items": items}, request=req)

    def delete(self, url, headers=None, **kw):
        self._auth(headers)
        return httpx.Response(204, request=httpx.Request("DELETE", url))


# ── world: users, organizations, projects; one HTTP client acting as a chosen user ──


@pytest.fixture()
def world(database, settings_env, monkeypatch):
    from src.cloud_imagery import azure
    from src.main import app

    fake_azure, tiler = FakeAzure(azure), FakeTiler()
    monkeypatch.setattr(azure, "list_blobs", fake_azure.list_blobs)
    monkeypatch.setattr(azure, "get_blob", fake_azure.get_blob)
    monkeypatch.setattr(httpx, "get", tiler.get)
    monkeypatch.setattr(httpx, "post", tiler.post)
    monkeypatch.setattr(httpx, "delete", tiler.delete)

    tag = uuid.uuid4().hex[:8]
    db = SessionLocal()
    roles = ("p1_admin", "p2_admin", "org_admin", "org_member", "stranger")
    users = {r: User(issuer="test", external_uid=f"{r}-{tag}", email=f"{r}-{tag}@t") for r in roles}
    org = Organization(name=f"org-{tag}", status="approved")
    other = Organization(name=f"other-{tag}", status="approved")
    db.add_all([*users.values(), org, other])
    db.flush()
    p1, p2 = Project(organization_id=org.id, name="p1"), Project(organization_id=org.id, name="p2")
    p3 = Project(organization_id=other.id, name="p3")
    db.add_all(
        [
            p1,
            p2,
            p3,
            *(OrganizationTiler(organization_id=o.id, tiler_name="hosted") for o in (org, other)),
        ]
    )
    db.flush()
    for role in ("p1_admin", "p2_admin", "org_admin", "org_member"):
        db.add(
            OrganizationUser(
                user_id=users[role].id,
                organization_id=org.id,
                is_admin=role == "org_admin",
                status="active",
            )
        )
    db.add(
        OrganizationUser(
            user_id=users["stranger"].id, organization_id=other.id, is_admin=True, status="active"
        )
    )
    for role, project in (("p1_admin", p1), ("p2_admin", p2), ("stranger", p3)):
        db.add(ProjectUser(user_id=users[role].id, project_id=project.id, is_admin=True))
    db.commit()
    ids = {r: u.id for r, u in users.items()}
    w = {"org": org.id, "p1": p1.id, "p2": p2.id, "p3": p3.id, "tiler": tiler, "azure": fake_azure}
    db.close()

    current = {"id": ids["p1_admin"]}
    app.dependency_overrides[require_authenticated_user] = lambda db=Depends(get_db): db.get(
        User, current["id"]
    )
    client = TestClient(app)

    def as_(role):
        current["id"] = ids[role]
        return client

    w["as"] = as_
    yield w
    if tiler.hold:
        tiler.hold[1].set()
    app.dependency_overrides.clear()


def _create(client, owner, /, **over):
    body = {
        "title": "Drone flights",
        "owner": owner,
        "tiler": "hosted",
        "container_url": CONTAINER,
        "prefix": "flights/",
        "storage_access": {"kind": "azure_sas", "secret": SECRET},
        "data_region": None,
    }
    return client.post("/api/cloud-imagery/collections", json={**body, **over})


def _files(world, *paths):
    return [
        {"path": p, "etag": world["azure"].blobs[p].etag, "datetime": "2026-01-12T10:20:00Z"}
        for p in paths
    ]


def _wait(client, import_id, timeout=15):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        body = client.get(f"/api/cloud-imagery/imports/{import_id}").json()
        if body["status"] in ("ready", "failed"):
            return body
        time.sleep(0.05)
    raise AssertionError(f"import {import_id} never finished: {body}")


def _import(client, cid, files):
    return client.post(f"/api/cloud-imagery/collections/{cid}/imports", json={"files": files})


def _ready_collection(world, owner, role="p1_admin"):
    client = world["as"](role)
    cid = _create(client, owner).json()["id"]
    assert (
        _wait(client, _import(client, cid, _files(world, "flights/a.tif")).json()["id"])["status"]
        == "ready"
    )
    return cid


# ── creation, secrets and ownership ────────────────────────────────────────────


def test_project_admin_creates_project_catalog_and_secret_stays_write_only(world):
    client = world["as"]("p1_admin")
    r = _create(client, {"project_id": world["p1"]}, data_region="westeurope")

    assert r.status_code == 201, r.text
    body = r.json()
    assert body["status"] == "draft" and body["owner"] == {"project_id": world["p1"]}
    assert body["storage_access"]["kind"] == "azure_sas"
    assert body["storage_access"]["expires_at"].startswith("2099-01-01")
    assert body["data_region"] == "westeurope" and body["tiler_region"] is None
    shown = r.text + client.get(f"/api/cloud-imagery/collections/{body['id']}").text
    assert "TOPSECRET" not in shown and "sig=" not in shown


@pytest.mark.parametrize(
    ("role", "scope", "expected"),
    [
        ("p2_admin", "p1", 403),
        ("org_member", "org", 403),
        ("stranger", "org", 403),
        ("org_admin", "org", 201),
    ],
    ids=["other project admin", "org member", "other org admin", "org admin"],
)
def test_catalog_creation_requires_admin_of_the_owning_scope(world, role, scope, expected):
    owner = {"organization_id": world["org"]} if scope == "org" else {"project_id": world["p1"]}
    assert _create(world["as"](role), owner).status_code == expected


@pytest.mark.parametrize(
    "over",
    [
        {"owner": {}},
        {"owner": {"project_id": 1, "organization_id": 1}},
        {"container_url": "https://evil.example.com/imagery"},
        {"container_url": f"http://{HOST}/imagery"},
        {"storage_access": {"kind": "azure_sas", "secret": SECRET.replace("sp=rl", "sp=rw")}},
        {"tiler": "not-allowed"},
    ],
    ids=["no owner", "two owners", "not azure blob", "not https", "writable sas", "unknown tiler"],
)
def test_catalog_creation_rejects_bad_owner_location_access_or_tiler(world, over):
    r = _create(world["as"]("org_admin"), {"organization_id": world["org"]}, **over)
    assert r.status_code in (400, 403, 422)


def test_ready_org_catalogs_are_reused_but_project_catalogs_stay_in_their_project(world):
    org_cat = _ready_collection(world, {"organization_id": world["org"]}, role="org_admin")
    p1_cat = _ready_collection(world, {"project_id": world["p1"]})
    draft = _create(world["as"]("p1_admin"), {"project_id": world["p1"]}).json()["id"]

    p1_ids = {
        c["id"]
        for c in world["as"]("p1_admin")
        .get(f"/api/cloud-imagery/collections?project_id={world['p1']}")
        .json()["items"]
    }
    p2 = world["as"]("p2_admin")
    p2_ids = {
        c["id"]
        for c in p2.get(f"/api/cloud-imagery/collections?project_id={world['p2']}").json()["items"]
    }

    assert {org_cat, p1_cat} <= p1_ids and draft not in p1_ids
    assert org_cat in p2_ids and p1_cat not in p2_ids
    assert p2.get(f"/api/cloud-imagery/collections/{p1_cat}").status_code == 404
    stranger = world["as"]("stranger")
    assert stranger.get(f"/api/cloud-imagery/collections?project_id={world['p1']}").status_code in (
        403,
        404,
    )
    assert stranger.get(f"/api/cloud-imagery/collections/{org_cat}").status_code == 404


# ── discovery ───────────────────────────────────────────────────────────────────


def test_discovery_pages_through_tiff_objects_relative_to_the_container(world):
    client = world["as"]("p1_admin")
    cid = _create(client, {"project_id": world["p1"]}).json()["id"]

    first = client.get(f"/api/cloud-imagery/collections/{cid}/discover?limit=2").json()
    cursor = first["next_cursor"]
    second = client.get(
        f"/api/cloud-imagery/collections/{cid}/discover?limit=2&cursor={cursor}"
    ).json()

    objects = first["objects"] + second["objects"]
    assert [o["path"] for o in objects] == ["flights/a.tif", "flights/b.tif", "flights/c.tiff"]
    assert objects[0]["etag"] == '"0x0"' and second["next_cursor"] is None
    assert (
        world["as"]("p2_admin").get(f"/api/cloud-imagery/collections/{cid}/discover").status_code
        == 404
    )


# ── import: validation, background run, failures, readiness ─────────────────────

_T = "2026-01-12T10:20:00Z"
_BAD_FILES = {
    "empty": [],
    "naive time": [{"path": "flights/a.tif", "etag": '"0x0"', "datetime": "2026-01-12T10:20:00"}],
    "start after end": [
        {
            "path": "flights/a.tif",
            "etag": '"0x0"',
            "start_datetime": "2026-02-01T00:00:00Z",
            "end_datetime": "2026-01-01T00:00:00Z",
        }
    ],
    "both time forms": [
        {
            "path": "flights/a.tif",
            "etag": '"0x0"',
            "datetime": _T,
            "start_datetime": _T,
            "end_datetime": _T,
        }
    ],
    "no time": [{"path": "flights/a.tif", "etag": '"0x0"'}],
    "duplicate path": [{"path": "flights/a.tif", "etag": '"0x0"', "datetime": _T}] * 2,
    "path escapes prefix": [{"path": "flights/../x/a.tif", "etag": '"0x0"', "datetime": _T}],
    "path outside prefix": [{"path": "other/a.tif", "etag": '"0x0"', "datetime": _T}],
}


@pytest.mark.parametrize("files", _BAD_FILES.values(), ids=_BAD_FILES.keys())
def test_import_rejects_invalid_selection_without_starting_a_run(world, files):
    client = world["as"]("p1_admin")
    cid = _create(client, {"project_id": world["p1"]}).json()["id"]
    assert _import(client, cid, files).status_code == 422
    assert world["tiler"].batches == []
    assert client.get(f"/api/cloud-imagery/collections/{cid}").json()["status"] == "draft"


def test_import_runs_in_background_in_bounded_batches_and_becomes_ready(world):
    client, tiler = world["as"]("p1_admin"), world["tiler"]
    cid = _create(client, {"project_id": world["p1"]}).json()["id"]
    files = _files(world, "flights/a.tif", "flights/b.tif") + [
        {
            "path": "flights/c.tiff",
            "etag": '"0x2"',
            "start_datetime": "2026-01-01",
            "end_datetime": "2026-01-31",
        }
    ]

    r = _import(client, cid, files)

    assert r.status_code == 202, r.text
    assert r.json()["status"] == "registering" and r.json()["total"] == 3
    done = _wait(client, r.json()["id"])
    assert done["status"] == "ready" and done["completed"] == 3 and done["errors"] == []
    assert all(len(batch) <= 2 for batch in tiler.batches)
    assert tiler.verified == [sorted(_item_id(f"{CONTAINER}/{f['path']}") for f in files)]
    assert client.get(f"/api/cloud-imagery/collections/{cid}").json()["status"] == "ready"


def test_import_refuses_a_tiler_without_the_catalog_capability(world):
    client = world["as"]("p1_admin")
    world["tiler"].capable = False
    cid = _create(client, {"project_id": world["p1"]}).json()["id"]
    r = _import(client, cid, _files(world, "flights/a.tif"))
    assert r.status_code == 409 and "tiler" in r.text.lower()


def _drop(w):
    del w["azure"].blobs["flights/b.tif"]


def _overwrite(w):
    w["azure"].blobs["flights/b.tif"] = dataclasses.replace(
        w["azure"].blobs["flights/b.tif"], etag='"changed"'
    )


def _corrupt(w):
    w["tiler"].reject[f"{CONTAINER}/flights/b.tif"] = "invalid_raster"


@pytest.mark.parametrize(
    ("break_it", "code"),
    [(_drop, "object_missing"), (_overwrite, "object_changed"), (_corrupt, "invalid_raster")],
    ids=["missing", "changed", "invalid raster"],
)
def test_unusable_object_fails_import_visibly_and_catalog_is_never_ready(world, break_it, code):
    client = world["as"]("p1_admin")
    cid = _create(client, {"project_id": world["p1"]}).json()["id"]
    files = _files(world, "flights/a.tif", "flights/b.tif")
    break_it(world)

    done = _wait(client, _import(client, cid, files).json()["id"])

    assert done["status"] == "failed"
    assert any(e["code"] == code and e["path"] == "flights/b.tif" for e in done["errors"])
    assert "TOPSECRET" not in json.dumps(done)
    assert world["tiler"].verified == []
    assert client.get(f"/api/cloud-imagery/collections/{cid}").json()["status"] == "failed"
    listed = client.get(f"/api/cloud-imagery/collections?project_id={world['p1']}").json()["items"]
    assert cid not in {c["id"] for c in listed}


def test_retry_resends_only_unfinished_batches_and_then_publishes(world):
    client, tiler = world["as"]("p1_admin"), world["tiler"]
    cid = _create(client, {"project_id": world["p1"]}).json()["id"]
    files = _files(world, "flights/a.tif", "flights/b.tif", "flights/c.tiff")
    tiler.fail_once = {f"{CONTAINER}/flights/c.tiff"}

    imp = _import(client, cid, files).json()
    failed = _wait(client, imp["id"])
    assert failed["status"] == "failed" and failed["retryable"] is True and failed["completed"] == 2
    assert client.post(f"/api/cloud-imagery/imports/{imp['id']}/retry").status_code == 202
    done = _wait(client, imp["id"])

    assert done["status"] == "ready" and done["completed"] == 3
    sent = [h for batch in tiler.batches for h in batch]
    assert sent.count(f"{CONTAINER}/flights/a.tif") == 1
    assert tiler.verified == [sorted(_item_id(f"{CONTAINER}/{f['path']}") for f in files)]
    assert client.post(f"/api/cloud-imagery/imports/{imp['id']}/retry").status_code == 409


def test_imports_are_bounded_globally_and_one_per_collection(world):
    client, tiler = world["as"]("p1_admin"), world["tiler"]
    first = _create(client, {"project_id": world["p1"]}).json()["id"]
    second = _create(client, {"project_id": world["p1"]}).json()["id"]
    entered, release = threading.Event(), threading.Event()
    tiler.hold = (entered, release)
    files = _files(world, "flights/a.tif")

    running = _import(client, first, files)
    assert running.status_code == 202 and entered.wait(10)
    assert (
        client.get(f"/api/cloud-imagery/collections/{first}").status_code == 200
    )  # app stays usable
    assert _import(client, first, files).status_code == 409
    assert _import(client, second, files).status_code == 429
    release.set()
    _wait(client, running.json()["id"])


def test_interrupted_import_fails_on_poll_and_late_old_attempt_cannot_overwrite_retry(
    world, database
):
    from src.cloud_imagery.models import CloudImageryImport

    client, tiler = world["as"]("p1_admin"), world["tiler"]
    cid = _create(client, {"project_id": world["p1"]}).json()["id"]
    entered, release = threading.Event(), threading.Event()
    tiler.hold, tiler.hold_status = (entered, release), 503
    imp = _import(client, cid, _files(world, "flights/a.tif")).json()
    assert entered.wait(10)

    with database.begin() as conn:  # the worker died: its heartbeat stopped long ago
        conn.execute(
            text(
                f"UPDATE {CloudImageryImport.__table__} "
                "SET heartbeat_at = now() - interval '1 hour' WHERE id = :id"
            ),
            {"id": imp["id"]},
        )
    interrupted = client.get(f"/api/cloud-imagery/imports/{imp['id']}").json()
    assert interrupted["status"] == "failed" and interrupted["retryable"] is True
    assert interrupted["errors"]

    assert client.post(f"/api/cloud-imagery/imports/{imp['id']}/retry").status_code == 202
    assert _wait(client, imp["id"])["status"] == "ready"
    release.set()  # the old attempt wakes to a failed batch and must stay fenced out
    time.sleep(1.0)
    assert client.get(f"/api/cloud-imagery/imports/{imp['id']}").json()["status"] == "ready"
    assert client.get(f"/api/cloud-imagery/collections/{cid}").json()["status"] == "ready"


# ── managed reference used by campaign imagery registration ─────────────────────


def test_managed_reference_resolves_only_ready_catalogs_in_the_projects_scopes(world):
    from src.cloud_imagery.service import resolve_managed_collection

    org_cat = _ready_collection(world, {"organization_id": world["org"]}, role="org_admin")
    p1_cat = _ready_collection(world, {"project_id": world["p1"]})
    draft = _create(world["as"]("p1_admin"), {"project_id": world["p1"]}).json()["id"]
    db = SessionLocal()
    try:
        ref = resolve_managed_collection(db, world["p2"], org_cat)
        assert ref.tiler == "hosted"
        assert re.fullmatch(r"cc-[0-9a-f]{32}", ref.stac_collection_id)
        assert ref.storage_access["host"] == HOST
        assert "TOPSECRET" not in json.dumps(ref.storage_access)
        for project, catalog, status in (
            (world["p2"], p1_cat, 404),
            (world["p3"], org_cat, 404),
            (world["p1"], draft, 409),
        ):
            with pytest.raises(HTTPException) as exc:
                resolve_managed_collection(db, project, catalog)
            assert exc.value.status_code == status
    finally:
        db.close()


# ── management listing: drafts on revisit, picker stays ready-only ───────────────
# Additive contract: GET /collections?project_id=P&include_drafts=true and
# GET /collections?organization_id=O&include_drafts=true list every catalog the caller may
# manage in that one context (draft, importing, failed, ready). Exactly one context is
# required; without include_drafts the list stays the READY-only campaign picker.


def _ids(response):
    assert response.status_code == 200, response.text
    return {c["id"] for c in response.json()["items"]}


def test_project_management_listing_shows_unfinished_catalogs_but_picker_stays_ready_only(world):
    client, tiler = world["as"]("p1_admin"), world["tiler"]
    ready = _ready_collection(world, {"project_id": world["p1"]})
    draft = _create(client, {"project_id": world["p1"]}).json()["id"]
    failed = _create(client, {"project_id": world["p1"]}).json()["id"]
    _corrupt(world)
    _wait(client, _import(client, failed, _files(world, "flights/b.tif")).json()["id"])
    importing = _create(client, {"project_id": world["p1"]}).json()["id"]
    entered, release = threading.Event(), threading.Event()
    tiler.hold = (entered, release)
    run = _import(client, importing, _files(world, "flights/a.tif")).json()
    assert entered.wait(10)
    try:
        managed = _ids(
            client.get(
                f"/api/cloud-imagery/collections?project_id={world['p1']}&include_drafts=true"
            )
        )
        picker = _ids(client.get(f"/api/cloud-imagery/collections?project_id={world['p1']}"))
        other = _ids(
            world["as"]("p2_admin").get(
                f"/api/cloud-imagery/collections?project_id={world['p2']}&include_drafts=true"
            )
        )
        outsider = world["as"]("stranger").get(
            f"/api/cloud-imagery/collections?project_id={world['p1']}&include_drafts=true"
        )
    finally:
        release.set()
        _wait(world["as"]("p1_admin"), run["id"])

    assert {ready, draft, failed, importing} <= managed
    assert ready in picker and not {draft, failed, importing} & picker
    assert not {ready, draft, failed, importing} & other
    assert outsider.status_code in (403, 404) and "Drone flights" not in outsider.text


def test_org_catalog_is_created_and_managed_without_any_project_context(world):
    org_admin = world["as"]("org_admin")
    created = _create(org_admin, {"organization_id": world["org"]})
    assert created.status_code == 201, created.text
    draft = created.json()["id"]

    managed = _ids(
        org_admin.get(
            f"/api/cloud-imagery/collections?organization_id={world['org']}&include_drafts=true"
        )
    )
    picker = _ids(org_admin.get(f"/api/cloud-imagery/collections?organization_id={world['org']}"))
    outsider = world["as"]("stranger").get(
        f"/api/cloud-imagery/collections?organization_id={world['org']}&include_drafts=true"
    )

    assert draft in managed and draft not in picker
    assert outsider.status_code in (403, 404) and "Drone flights" not in outsider.text


@pytest.mark.parametrize(
    "query",
    ["include_drafts=true", "project_id={p1}&organization_id={org}&include_drafts=true"],
    ids=["no context", "two contexts"],
)
def test_catalog_listing_requires_exactly_one_context(world, query):
    url = "/api/cloud-imagery/collections?" + query.format(p1=world["p1"], org=world["org"])
    assert world["as"]("org_admin").get(url).status_code == 422


# ── visualization presets: the imagery VizParams schema, stored as an independent copy ──

_PRESET = {
    "name": "True colour",
    "viz_params": {"assets": ["visual"], "bidx": [3, 2, 1], "rescale": "0,3000"},
}


def _presets(response):
    assert response.status_code in (200, 201), response.text
    return [
        {"name": v["name"], "viz_params": {k: v["viz_params"][k] for k in _PRESET["viz_params"]}}
        for v in response.json()["visualizations"]
    ]


def test_visualization_preset_round_trips_and_is_copied_independently_of_its_source(world):
    client = world["as"]("p1_admin")
    sent = json.loads(json.dumps(_PRESET))
    first = _create(client, {"project_id": world["p1"]}, visualizations=[sent])
    copy = _create(client, {"project_id": world["p1"]}, visualizations=_presets(first))
    first_id, copy_id = first.json()["id"], copy.json()["id"]

    changed = {"name": "False colour", "viz_params": {**_PRESET["viz_params"], "bidx": [4, 3, 2]}}
    patched = client.patch(
        f"/api/cloud-imagery/collections/{first_id}", json={"visualizations": [changed]}
    )

    assert _presets(first) == [_PRESET] and _presets(copy) == [_PRESET]
    assert _presets(patched) == [changed]
    assert _presets(client.get(f"/api/cloud-imagery/collections/{copy_id}")) == [_PRESET]


@pytest.mark.parametrize(
    "viz_params",
    [{"bidx": ["red"]}, {"rescale": ["0", "3000"]}, {"assets": "visual"}],
    ids=["non-integer band", "rescale not a string", "assets not a list"],
)
def test_visualization_preset_rejects_params_the_imagery_schema_rejects(world, viz_params):
    client = world["as"]("p1_admin")
    bad = [{"name": "Broken", "viz_params": viz_params}]
    assert _create(client, {"project_id": world["p1"]}, visualizations=bad).status_code == 422
    cid = _create(client, {"project_id": world["p1"]}).json()["id"]
    patch = client.patch(f"/api/cloud-imagery/collections/{cid}", json={"visualizations": bad})
    assert patch.status_code == 422


# ── review regressions ──────────────────────────────────────────────────────────


def test_swept_import_stays_failed_when_its_still_live_worker_finishes(
    world, database, monkeypatch
):
    from src.cloud_imagery import azure
    from src.cloud_imagery.models import CloudImageryImport
    from src.cloud_imagery.service import resolve_managed_collection

    client = world["as"]("p1_admin")
    cid = _create(client, {"project_id": world["p1"]}).json()["id"]
    entered, release = threading.Event(), threading.Event()
    fake_get_blob = azure.get_blob

    def slow_get_blob(container_url, sas, path):
        entered.set()
        release.wait(20)
        return fake_get_blob(container_url, sas, path)

    monkeypatch.setattr(azure, "get_blob", slow_get_blob)
    imp = _import(client, cid, _files(world, "flights/a.tif", "flights/b.tif")).json()
    assert entered.wait(10)
    with database.begin() as conn:  # the worker is alive but looks dead: no retry follows
        conn.execute(
            text(
                f"UPDATE {CloudImageryImport.__table__} "
                "SET heartbeat_at = now() - interval '1 hour' WHERE id = :id"
            ),
            {"id": imp["id"]},
        )
    swept = client.get(f"/api/cloud-imagery/imports/{imp['id']}").json()
    assert swept["status"] == "failed"

    release.set()
    time.sleep(2.0)

    final = client.get(f"/api/cloud-imagery/imports/{imp['id']}").json()
    catalog = client.get(f"/api/cloud-imagery/collections/{cid}").json()
    assert final["status"] == "failed" and final["retryable"] is True
    assert catalog["status"] == "failed" and catalog["item_count"] is None
    assert world["tiler"].verified == []
    db = SessionLocal()
    try:
        with pytest.raises(HTTPException) as exc:
            resolve_managed_collection(db, world["p1"], cid)
        assert exc.value.status_code == 409
    finally:
        db.close()


_ODD_KEY = "flights/drone run 100%@2x.tif"


def _with_odd_key(world):
    from src.cloud_imagery import azure

    world["azure"].blobs[_ODD_KEY] = azure.Blob(path=_ODD_KEY, etag='"0x9"', size=2000)
    return f"{CONTAINER}/{quote(_ODD_KEY)}"


def test_import_sends_url_encoded_href_for_a_blob_key_with_reserved_characters(world):
    client, tiler = world["as"]("p1_admin"), world["tiler"]
    encoded = _with_odd_key(world)
    cid = _create(client, {"project_id": world["p1"]}).json()["id"]

    done = _wait(client, _import(client, cid, _files(world, _ODD_KEY)).json()["id"])

    assert tiler.batches == [[encoded]]
    assert encoded.endswith("drone%20run%20100%25%402x.tif")
    assert done["status"] == "ready" and done["completed"] == 1, done
    assert tiler.verified == [[_item_id(encoded)]]


def test_tiler_rejection_of_an_encoded_href_is_reported_on_the_original_blob_path(world):
    client = world["as"]("p1_admin")
    world["tiler"].reject[_with_odd_key(world)] = "invalid_raster"
    cid = _create(client, {"project_id": world["p1"]}).json()["id"]

    done = _wait(client, _import(client, cid, _files(world, _ODD_KEY)).json()["id"])

    assert done["status"] == "failed"
    assert [(e["code"], e["path"]) for e in done["errors"]] == [("invalid_raster", _ODD_KEY)]


def test_org_catalog_is_usable_across_projects_but_managed_only_by_its_creator_or_org_admin(
    world,
):
    from src.cloud_imagery.service import resolve_managed_collection

    by_org_admin = _ready_collection(world, {"organization_id": world["org"]}, role="org_admin")
    by_p2_admin = _create(world["as"]("p2_admin"), {"organization_id": world["org"]})
    assert by_p2_admin.status_code == 201, by_p2_admin.text
    own = by_p2_admin.json()["id"]

    db = SessionLocal()
    try:
        assert resolve_managed_collection(db, world["p1"], by_org_admin).tiler == "hosted"
    finally:
        db.close()
    p1 = world["as"]("p1_admin")
    for cid in (by_org_admin, own):
        url = f"/api/cloud-imagery/collections/{cid}"
        assert p1.patch(url, json={"title": "Taken"}).status_code in (403, 404)
        assert p1.get(f"{url}/discover").status_code in (403, 404)
        assert p1.delete(url).status_code in (403, 404)

    p2 = world["as"]("p2_admin")
    own_url = f"/api/cloud-imagery/collections/{own}"
    assert p2.patch(own_url, json={"title": "Mine"}).status_code == 200
    assert p2.get(f"{own_url}/discover").status_code == 200
    org_admin = world["as"]("org_admin")
    assert org_admin.patch(own_url, json={"title": "Org"}).status_code == 200
