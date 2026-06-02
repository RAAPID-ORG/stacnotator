"""Unit tests for the storage abstraction (LocalStorage)."""

import pytest

from src.imagery.storage import LocalStorage


@pytest.fixture()
def tmp_storage(tmp_path):
    return LocalStorage(base_path=str(tmp_path))


class TestLocalStorage:
    def test_save_writes_file(self, tmp_storage, tmp_path):
        tmp_storage.save("campaigns/1/custom-maps/abc.tif", b"GeoTIFF data")
        assert (tmp_path / "campaigns/1/custom-maps/abc.tif").read_bytes() == b"GeoTIFF data"

    def test_save_creates_parent_dirs(self, tmp_storage, tmp_path):
        tmp_storage.save("a/b/c/d.tif", b"x")
        assert (tmp_path / "a/b/c/d.tif").exists()

    def test_get_accessible_url_returns_full_path(self, tmp_storage, tmp_path):
        url = tmp_storage.get_accessible_url("campaigns/1/custom-maps/abc.tif")
        assert url == str(tmp_path / "campaigns/1/custom-maps/abc.tif")

    def test_delete_removes_file(self, tmp_storage, tmp_path):
        path = tmp_path / "campaigns/1/custom-maps/abc.tif"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"data")

        tmp_storage.delete("campaigns/1/custom-maps/abc.tif")

        assert not path.exists()

    def test_delete_missing_file_does_not_raise(self, tmp_storage):
        # Should silently succeed
        tmp_storage.delete("nonexistent/file.tif")

    def test_save_overwrites_existing(self, tmp_storage, tmp_path):
        tmp_storage.save("campaigns/1/test.tif", b"old")
        tmp_storage.save("campaigns/1/test.tif", b"new")
        assert (tmp_path / "campaigns/1/test.tif").read_bytes() == b"new"
