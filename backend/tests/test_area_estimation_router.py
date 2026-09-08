"""The area estimation API end to end, against a temporary workspace and a runner
that executes jobs inline. DB-free: the campaign dependencies are overridden."""

import json
from types import SimpleNamespace
from unittest.mock import MagicMock

import numpy as np
import pytest
import rasterio
from fastapi.testclient import TestClient
from rasterio.transform import from_origin

from src.area_estimation import jobs, service
from src.area_estimation import router as ae_router
from src.area_estimation.workspace import Workspace
from src.auth.dependencies import require_authenticated_user
from src.campaigns.dependencies import require_campaign_admin
from src.database import get_db
from src.main import app

CAMPAIGN_ID = 11
LAEA = "+proj=laea +lat_0=1 +lon_0=34 +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs"
BASE = f"/api/campaigns/{CAMPAIGN_ID}/area-estimation"


class InlineRunner:
    def __init__(self, workspace: Workspace):
        self._workspace = workspace

    def submit(self, job):
        jobs.execute(self._workspace, job, max_grid_pixels=10**9)


@pytest.fixture()
def client(tmp_path, monkeypatch):
    workspace = Workspace(tmp_path)
    monkeypatch.setattr(service, "workspace", lambda: workspace)
    monkeypatch.setattr(service, "runner", lambda: InlineRunner(workspace))
    app.dependency_overrides[get_db] = lambda: MagicMock()
    app.dependency_overrides[require_authenticated_user] = lambda: SimpleNamespace(id="u1")
    app.dependency_overrides[require_campaign_admin] = lambda: SimpleNamespace(id=CAMPAIGN_ID)
    app.dependency_overrides[ae_router.bearer] = lambda: None
    yield TestClient(app)
    app.dependency_overrides.clear()


def geotiff(data: np.ndarray, crs: str, transform, nodata=None) -> bytes:
    with rasterio.io.MemoryFile() as memory:
        with memory.open(
            driver="GTiff",
            width=data.shape[1],
            height=data.shape[0],
            count=1,
            dtype=data.dtype,
            crs=crs,
            transform=transform,
            nodata=nodata,
        ) as ds:
            ds.write(data, 1)
        return memory.read()


@pytest.fixture()
def map_data():
    return np.random.default_rng(0).integers(0, 4, (60, 80)).astype("uint8")


@pytest.fixture()
def map_id(client, map_data):
    tif = geotiff(map_data, LAEA, from_origin(-400, 300, 10, 10), nodata=0)
    response = client.post(BASE + "/maps", files=[("files", ("crop.tif", tif, "image/tiff"))])
    assert response.status_code == 201, response.text
    return response.json()["id"]


def expected_counts(data: np.ndarray) -> dict[str, int]:
    values, counts = np.unique(data, return_counts=True)
    return {str(int(v)): int(c) for v, c in zip(values, counts, strict=True)}


def test_upload_inspects_the_map(client, map_id):
    body = client.get(f"{BASE}/maps/{map_id}").json()
    assert body["sources"][0] == {"kind": "upload", "name": "crop.tif", "location": "00-crop.tif"}
    assert body["info"]["is_equal_area"] is True
    assert body["info"]["bands"][0]["nodata"] == 0
    assert body["info"]["sources"][0]["pixel_area_m2"] == 100
    assert body["preprocess"] is None
    assert [m["id"] for m in client.get(BASE + "/maps").json()] == [map_id]


def test_rejects_files_that_are_not_rasters(client):
    response = client.post(
        BASE + "/maps", files=[("files", ("x.tif", b"not a tiff", "image/tiff"))]
    )
    assert response.status_code == 400
    assert "could not be opened" in response.json()["detail"]
    assert client.get(BASE + "/maps").json() == []


def test_link_rejects_private_hosts(client):
    response = client.post(BASE + "/maps/link", json={"urls": ["http://127.0.0.1/map.tif"]})
    assert response.status_code == 400
    response = client.post(BASE + "/maps/link", json={"urls": ["ftp://example.com/map.tif"]})
    assert response.status_code == 400


def test_preprocess_then_stratify(client, map_id, map_data):
    response = client.post(f"{BASE}/maps/{map_id}/preprocess", json={"crs": LAEA})
    assert response.status_code == 202, response.text
    job = client.get(f"{BASE}/jobs/{response.json()['id']}").json()
    assert job["status"] == "done", job
    assert job["progress"] == 1.0
    census = job["result"]
    assert census["total"] == expected_counts(map_data)
    assert census["footprint_pixels"] == map_data.size
    assert census["declared_nodata"] == [0]
    assert census["grid"]["resolution_m"] == 10

    body = client.get(f"{BASE}/maps/{map_id}").json()
    assert body["active_job_id"] is None
    assert body["preprocess"]["census"]["total"] == census["total"]

    strata = {
        "classes": [{"id": "crop", "values": [1, 2]}, {"id": "other", "values": [3]}],
        "nodata_values": [0],
    }
    response = client.post(f"{BASE}/maps/{map_id}/stratify", json=strata)
    assert response.status_code == 202, response.text
    job = client.get(f"{BASE}/jobs/{response.json()['id']}").json()
    assert job["status"] == "done", job
    counts = expected_counts(map_data)
    assert job["result"]["total"] == {"crop": counts["1"] + counts["2"], "other": counts["3"]}
    assert job["result"]["nodata_pixels"] == counts["0"]
    assert job["result"]["codes"] == {"crop": 1, "other": 2}
    assert client.get(f"{BASE}/maps/{map_id}").json()["strata"]["census"] == job["result"]


def test_stratify_needs_every_value_assigned(client, map_id):
    client.post(f"{BASE}/maps/{map_id}/preprocess", json={"crs": LAEA})
    response = client.post(
        f"{BASE}/maps/{map_id}/stratify", json={"classes": [{"id": "crop", "values": [1]}]}
    )
    assert response.status_code == 400
    assert "0, 2, 3" in response.json()["detail"]


def test_stratify_before_preprocess_is_refused(client, map_id):
    response = client.post(
        f"{BASE}/maps/{map_id}/stratify", json={"classes": [{"id": "crop", "values": [1]}]}
    )
    assert response.status_code == 400


def test_preprocess_refuses_a_crs_that_is_not_equal_area(client, map_id):
    response = client.post(f"{BASE}/maps/{map_id}/preprocess", json={"crs": "EPSG:3857"})
    assert response.status_code == 400
    assert "does not preserve area" in response.json()["detail"]
    response = client.post(f"{BASE}/maps/{map_id}/preprocess", json={"crs": LAEA, "band": 2})
    assert response.status_code == 400


def test_areas_split_the_census(client, map_id, map_data):
    # Two rectangles in EPSG:4326 covering the map's left and right halves.
    from rasterio.warp import transform_bounds

    left = transform_bounds(LAEA, "EPSG:4326", -400, -300, 0, 300)
    right = transform_bounds(LAEA, "EPSG:4326", 0, -300, 400, 300)

    def feature(name, b):
        ring = [[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]], [b[0], b[1]]]
        return {
            "type": "Feature",
            "properties": {"name": name},
            "geometry": {"type": "Polygon", "coordinates": [ring]},
        }

    collection = {
        "type": "FeatureCollection",
        "features": [feature("West", left), feature("East", right)],
    }
    response = client.put(
        f"{BASE}/maps/{map_id}/areas",
        files={"file": ("areas.geojson", json.dumps(collection).encode(), "application/geo+json")},
    )
    assert response.status_code == 200, response.text
    assert [a["name"] for a in response.json()["areas"]["areas"]] == ["West", "East"]

    response = client.post(f"{BASE}/maps/{map_id}/preprocess", json={"crs": LAEA})
    census = client.get(f"{BASE}/jobs/{response.json()['id']}").json()["result"]
    assert census["by_area"]["area-1"] == expected_counts(map_data[:, :40])
    assert census["by_area"]["area-2"] == expected_counts(map_data[:, 40:])

    body = client.delete(f"{BASE}/maps/{map_id}/areas").json()
    assert body["areas"] is None and body["preprocess"] is None


def test_overlapping_areas_are_refused(client, map_id):
    square = {
        "type": "Feature",
        "properties": {},
        "geometry": {
            "type": "Polygon",
            "coordinates": [[[34, 1], [34.1, 1], [34.1, 1.1], [34, 1.1], [34, 1]]],
        },
    }
    collection = {"type": "FeatureCollection", "features": [square, square]}
    response = client.put(
        f"{BASE}/maps/{map_id}/areas",
        files={"file": ("areas.geojson", json.dumps(collection).encode(), "application/geo+json")},
    )
    assert response.status_code == 400
    assert "overlap" in response.json()["detail"]


def test_busy_map_refuses_changes(client, map_id, tmp_path):
    record = service.workspace().read_map(CAMPAIGN_ID, map_id)
    record.active_job_id = "0" * 32
    service.workspace().write_map(record)
    job = jobs.JobRecord(
        id="0" * 32,
        campaign_id=CAMPAIGN_ID,
        map_id=map_id,
        kind="preprocess",
        spec={"crs": LAEA},
        status="running",
        created_at=jobs.now(),
        heartbeat_at=jobs.now(),
    )
    service.workspace().write_job(job)
    assert client.delete(f"{BASE}/maps/{map_id}").status_code == 409
    assert client.post(f"{BASE}/maps/{map_id}/preprocess", json={"crs": LAEA}).status_code == 409


def test_stale_job_is_swept_and_releases_the_map(client, map_id):
    from datetime import timedelta

    record = service.workspace().read_map(CAMPAIGN_ID, map_id)
    record.active_job_id = "1" * 32
    service.workspace().write_map(record)
    stale = jobs.now() - timedelta(seconds=jobs.STALE_AFTER_SECONDS + 1)
    job = jobs.JobRecord(
        id="1" * 32,
        campaign_id=CAMPAIGN_ID,
        map_id=map_id,
        kind="preprocess",
        spec={"crs": LAEA},
        status="running",
        created_at=stale,
        heartbeat_at=stale,
    )
    service.workspace().write_job(job)
    body = client.get(f"{BASE}/jobs/{'1' * 32}").json()
    assert body["status"] == "failed"
    assert body["error"] == jobs.INTERRUPTED_ERROR
    assert client.get(f"{BASE}/maps/{map_id}").json()["active_job_id"] is None
    assert client.delete(f"{BASE}/maps/{map_id}").status_code == 204
    assert client.get(f"{BASE}/maps/{map_id}").status_code == 404


def test_unknown_ids_are_404(client):
    assert client.get(f"{BASE}/maps/not-an-id").status_code == 404
    assert client.get(f"{BASE}/jobs/{'f' * 32}").status_code == 404
