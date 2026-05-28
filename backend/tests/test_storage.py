import time

import pytest

from src.config import get_settings


@pytest.fixture(autouse=True)
def _reset_settings_cache():
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


@pytest.fixture(autouse=True)
def _reset_backend_cache():
    from src import storage

    storage.get_backend.cache_clear()
    yield
    storage.get_backend.cache_clear()


def test_path_helpers_are_deterministic():
    from src import storage

    p = storage.custom_map_source_path(7, "abc-123", "crop.tif")
    assert p == "campaigns/7/custom-maps/abc-123/crop.tif"
    cog = storage.custom_map_cog_path(7, "abc-123")
    assert cog == "campaigns/7/custom-maps/abc-123/cog.tif"


def test_source_path_strips_directory_traversal():
    from src import storage

    p = storage.custom_map_source_path(1, "id", "../../etc/passwd")
    assert p == "campaigns/1/custom-maps/id/passwd"


def _configure_local(monkeypatch, root):
    monkeypatch.setenv("STORAGE_BACKEND", "local")
    monkeypatch.setenv("STORAGE_LOCAL_ROOT", str(root))
    monkeypatch.setenv("STORAGE_LOCAL_INTERNAL_BASE", "http://backend:8000")
    get_settings.cache_clear()
    from src import storage

    storage.get_backend.cache_clear()
    return storage


def test_local_signed_url_round_trip(monkeypatch, tmp_path):
    storage = _configure_local(monkeypatch, tmp_path)
    from src.storage.local import OP_WRITE, LocalFsStorage

    backend = storage.get_backend()
    assert isinstance(backend, LocalFsStorage)

    write_url = backend.generate_upload_url("campaigns/1/rasters/a/source.tif", ttl_minutes=15)
    assert write_url.startswith("/api/local-blob/")
    token = write_url.split("/")[3]
    backend.verify_token(token, "campaigns/1/rasters/a/source.tif", OP_WRITE)

    read_url = backend.generate_read_url("campaigns/1/rasters/a/cog.tif")
    assert read_url.startswith("http://backend:8000/api/local-blob/")


def test_local_token_rejects_wrong_op(monkeypatch, tmp_path):
    storage = _configure_local(monkeypatch, tmp_path)
    from src.storage.local import OP_READ

    backend = storage.get_backend()
    url = backend.generate_upload_url("p/q.tif", ttl_minutes=15)
    token = url.split("/")[3]
    with pytest.raises(ValueError):
        backend.verify_token(token, "p/q.tif", OP_READ)


def test_local_token_rejects_expired(monkeypatch, tmp_path):
    storage = _configure_local(monkeypatch, tmp_path)
    from src.storage.local import OP_WRITE

    backend = storage.get_backend()
    expiry = int(time.time()) - 1
    token = backend._token("p/q.tif", OP_WRITE, expiry)
    with pytest.raises(ValueError):
        backend.verify_token(token, "p/q.tif", OP_WRITE)


def test_local_token_rejects_path_tampering(monkeypatch, tmp_path):
    storage = _configure_local(monkeypatch, tmp_path)
    from src.storage.local import OP_WRITE

    backend = storage.get_backend()
    url = backend.generate_upload_url("p/q.tif", ttl_minutes=15)
    token = url.split("/")[3]
    with pytest.raises(ValueError):
        backend.verify_token(token, "other/path.tif", OP_WRITE)


def test_local_upload_then_exists_then_delete(monkeypatch, tmp_path):
    storage = _configure_local(monkeypatch, tmp_path)
    backend = storage.get_backend()

    src = tmp_path / "src.bin"
    src.write_bytes(b"hello world")

    backend.upload_from(src, "p/q.tif")
    assert backend.exists("p/q.tif")
    full = tmp_path / "p" / "q.tif"
    assert full.exists()
    assert full.read_bytes() == b"hello world"

    out = tmp_path / "out.bin"
    backend.download_to("p/q.tif", out)
    assert out.read_bytes() == b"hello world"

    backend.delete("p/q.tif")
    assert not backend.exists("p/q.tif")
    # Parent dir cleaned up when empty.
    assert not (tmp_path / "p").exists()


def test_local_full_path_rejects_traversal(monkeypatch, tmp_path):
    storage = _configure_local(monkeypatch, tmp_path)
    backend = storage.get_backend()
    with pytest.raises(ValueError):
        backend.full_path("../escape.tif")


def test_unknown_backend_raises(monkeypatch):
    monkeypatch.setenv("STORAGE_BACKEND", "s3")
    get_settings.cache_clear()
    from src import storage

    storage.get_backend.cache_clear()
    with pytest.raises(RuntimeError, match="Unknown STORAGE_BACKEND"):
        storage.get_backend()
