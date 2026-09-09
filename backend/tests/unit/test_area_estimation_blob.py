"""The blob workspace against an in-memory stand-in for the container client."""

from datetime import UTC, datetime, timedelta
from io import BytesIO
from types import SimpleNamespace

import pytest
from azure.core.exceptions import ResourceNotFoundError

from src.area_estimation import blob as blob_module
from src.area_estimation.blob import BlobWorkspace
from src.area_estimation.jobs import now
from src.area_estimation.schemas import (
    BandInfo,
    Bbox,
    JobRecord,
    MapInfo,
    MapRecord,
    SourceInfo,
    SourceRef,
)
from src.area_estimation.workspace import AREAS_FILE, REPROJECTED_FILE, UploadTooLarge, new_id

CAMPAIGN = 9


class _Container:
    def __init__(self):
        self.blobs: dict[str, bytes] = {}

    def upload_blob(self, name, data, overwrite=False, **kwargs):
        if isinstance(data, bytes):
            body = data
        elif hasattr(data, "read"):
            body = data.read()
        else:
            body = b"".join(data)
        self.blobs[name] = body

    def download_blob(self, name):
        if name not in self.blobs:
            raise ResourceNotFoundError("missing")
        return SimpleNamespace(readall=lambda: self.blobs[name])

    def list_blobs(self, name_starts_with=""):
        return [
            SimpleNamespace(name=n) for n in sorted(self.blobs) if n.startswith(name_starts_with)
        ]

    def delete_blob(self, name):
        if name not in self.blobs:
            raise ResourceNotFoundError("missing")
        del self.blobs[name]


class _Service:
    account_name = "acct"

    def __init__(self, container: _Container):
        self._container = container
        self.delegation_keys = 0

    def get_container_client(self, name):
        return self._container

    def get_user_delegation_key(self, start, expiry):
        self.delegation_keys += 1
        return "key"


def _info() -> MapInfo:
    band = BandInfo(index=1, dtype="uint8", description=None, nodata=None)
    bbox = Bbox(west=0, south=0, east=1, north=1)
    source = SourceInfo(
        name="m.tif",
        width=1,
        height=1,
        crs="EPSG:6933",
        crs_name="x",
        is_geographic=False,
        is_equal_area=True,
        resolution=(10, 10),
        pixel_area_m2=100,
        bbox=bbox,
        bands=[band],
    )
    return MapInfo(
        sources=[source],
        bands=[band],
        bbox=bbox,
        total_pixels=1,
        is_equal_area=True,
        proposed_crs="EPSG:6933",
    )


@pytest.fixture()
def container():
    return _Container()


@pytest.fixture()
def workspace(container, tmp_path, monkeypatch):
    monkeypatch.setattr(blob_module, "generate_container_sas", lambda *a, **k: "sig=abc")
    return BlobWorkspace(_Service(container), "ae", tmp_path)


def _record(map_id: str) -> MapRecord:
    return MapRecord(
        id=map_id,
        campaign_id=CAMPAIGN,
        created_at=now(),
        sources=[SourceRef(kind="upload", name="m.tif", location="00-m.tif")],
        info=_info(),
    )


class TestRecords:
    def test_map_records_round_trip_under_the_shared_key_layout(self, workspace, container):
        map_id = new_id()
        workspace.write_map(_record(map_id))
        assert f"campaign-{CAMPAIGN}/maps/{map_id}/map.json" in container.blobs
        assert workspace.read_map(CAMPAIGN, map_id).id == map_id
        assert [m.id for m in workspace.list_maps(CAMPAIGN)] == [map_id]
        assert workspace.read_map(CAMPAIGN, "f" * 32) is None
        assert list(workspace.list_maps(CAMPAIGN + 1)) == []

    def test_jobs_round_trip(self, workspace):
        job = JobRecord(
            id="a" * 32,
            campaign_id=CAMPAIGN,
            map_id="b" * 32,
            kind="preprocess",
            spec={"crs": "EPSG:6933"},
            status="queued",
            created_at=now(),
            heartbeat_at=now(),
        )
        workspace.write_job(job)
        assert workspace.read_job(CAMPAIGN, job.id).status == "queued"
        assert workspace.read_job(CAMPAIGN, "c" * 32) is None

    def test_deleting_a_map_removes_everything_under_it(self, workspace, container):
        map_id = new_id()
        workspace.write_map(_record(map_id))
        workspace.put_file(CAMPAIGN, map_id, "sources/00-m.tif", BytesIO(b"tif"), 10)
        other = new_id()
        workspace.write_map(_record(other))

        workspace.delete_map(CAMPAIGN, map_id)

        assert workspace.read_map(CAMPAIGN, map_id) is None
        assert all(map_id not in name for name in container.blobs)
        assert workspace.read_map(CAMPAIGN, other) is not None


class TestFiles:
    def test_uploads_stream_in_bounded_chunks(self, workspace, container):
        map_id = new_id()
        written = workspace.put_file(CAMPAIGN, map_id, "sources/00-m.tif", BytesIO(b"x" * 10), 10)
        assert written == 10
        assert container.blobs[f"campaign-{CAMPAIGN}/maps/{map_id}/sources/00-m.tif"] == b"x" * 10

    def test_an_oversized_upload_leaves_nothing_behind(self, workspace, container):
        map_id = new_id()
        with pytest.raises(UploadTooLarge):
            workspace.put_file(CAMPAIGN, map_id, "sources/00-m.tif", BytesIO(b"x" * 11), 10)
        assert container.blobs == {}

    def test_text_files_read_back_and_delete_quietly(self, workspace):
        map_id = new_id()
        workspace.put_file(CAMPAIGN, map_id, AREAS_FILE, BytesIO(b'{"a": 1}'), 100)
        assert workspace.read_text(CAMPAIGN, map_id, AREAS_FILE) == '{"a": 1}'
        workspace.delete_file(CAMPAIGN, map_id, AREAS_FILE)
        workspace.delete_file(CAMPAIGN, map_id, AREAS_FILE)
        assert workspace.read_text(CAMPAIGN, map_id, AREAS_FILE) is None

    def test_products_are_written_to_scratch_then_uploaded_and_cleaned(self, workspace, container):
        map_id = new_id()
        scratch = workspace.scratch_dir(CAMPAIGN, map_id)
        product = scratch / REPROJECTED_FILE
        product.write_bytes(b"raster")

        workspace.store_product(CAMPAIGN, map_id, REPROJECTED_FILE, product)

        key = f"campaign-{CAMPAIGN}/maps/{map_id}/{REPROJECTED_FILE}"
        assert container.blobs[key] == b"raster"
        assert not scratch.exists()

    def test_locations_are_vsiaz_urls_with_a_sas_for_gdal(self, workspace):
        map_id = new_id()
        assert workspace.location(CAMPAIGN, map_id, REPROJECTED_FILE) == (
            f"/vsiaz/ae/campaign-{CAMPAIGN}/maps/{map_id}/{REPROJECTED_FILE}"
        )
        assert workspace.gdal_options() == {
            "AZURE_STORAGE_ACCOUNT": "acct",
            "AZURE_STORAGE_SAS_TOKEN": "sig=abc",
        }


class TestSas:
    def test_a_sas_is_minted_once_and_renewed_only_near_expiry(self, workspace):
        service = workspace._service
        workspace.gdal_options()
        workspace.gdal_options()
        assert service.delegation_keys == 1

        soon = datetime.now(UTC) + blob_module.SAS_RENEW_BEFORE - timedelta(minutes=1)
        workspace._sas = ("old", soon)
        workspace.gdal_options()
        assert service.delegation_keys == 2


def test_from_url_wants_a_container_url():
    with pytest.raises(ValueError):
        BlobWorkspace.from_url("https://acct.blob.core.windows.net/", None)
    with pytest.raises(ValueError):
        BlobWorkspace.from_url("https://acct.blob.core.windows.net/ae/sub", None)
