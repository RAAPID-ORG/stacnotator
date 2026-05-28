from datetime import UTC, datetime, timedelta
from unittest.mock import MagicMock, patch
from uuid import UUID, uuid4

import pytest
from fastapi import HTTPException

from src.custom_maps import service
from src.custom_maps.models import (
    STATUS_FAILED,
    STATUS_PENDING,
    STATUS_PROCESSING,
    STATUS_READY,
    CustomMap,
)


def _make_custom_map(**overrides) -> CustomMap:
    custom_map = CustomMap.__new__(CustomMap)
    custom_map.id = overrides.get("id", uuid4())
    custom_map.campaign_id = overrides.get("campaign_id", 1)
    custom_map.uploaded_by_user_id = overrides.get("uploaded_by_user_id", uuid4())
    custom_map.name = overrides.get("name", "test custom map")
    custom_map.status = overrides.get("status", STATUS_PENDING)
    custom_map.source_path = overrides.get("source_path", "campaigns/1/custom-maps/x/source.tif")
    custom_map.cog_path = overrides.get("cog_path")
    custom_map.display_order = overrides.get("display_order", 0)
    custom_map.error_message = overrides.get("error_message")
    return custom_map


class TestGetForCampaign:
    def test_returns_custom_map_on_match(self):
        db = MagicMock()
        custom_map = _make_custom_map(campaign_id=42)
        db.execute.return_value.scalar_one_or_none.return_value = custom_map
        result = service.get_for_campaign(db, 42, custom_map.id)
        assert result is custom_map

    def test_raises_404_when_missing_or_wrong_campaign(self):
        db = MagicMock()
        db.execute.return_value.scalar_one_or_none.return_value = None
        with pytest.raises(HTTPException) as exc:
            service.get_for_campaign(db, 1, uuid4())
        assert exc.value.status_code == 404


class TestCreate:
    @patch("src.custom_maps.service.storage")
    def test_persists_pending_row_and_issues_upload_url(self, mock_storage):
        mock_storage.custom_map_source_path.return_value = "campaigns/1/custom-maps/abc/source.tif"
        mock_storage.get_backend.return_value.generate_upload_url.return_value = "http://upload-url"
        db = MagicMock()
        user_id = uuid4()

        custom_map, upload_url, upload_path, expires_in = service.create(
            db,
            campaign_id=1,
            user_id=user_id,
            name="crop classification",
            original_filename="crop.tif",
        )

        db.add.assert_called_once()
        db.commit.assert_called_once()
        assert custom_map.status == STATUS_PENDING
        assert custom_map.name == "crop classification"
        assert custom_map.campaign_id == 1
        assert custom_map.uploaded_by_user_id == user_id
        assert isinstance(custom_map.id, UUID)
        assert upload_url == "http://upload-url"
        assert upload_path == "campaigns/1/custom-maps/abc/source.tif"
        # 15 minute TTL by default → 900 seconds
        assert expires_in == 900


class TestCompleteUpload:
    @patch("src.custom_maps.service._spawn_worker")
    @patch("src.custom_maps.service.storage")
    def test_marks_processing_and_spawns_worker(self, mock_storage, mock_spawn):
        custom_map = _make_custom_map(status=STATUS_PENDING, campaign_id=1)
        mock_storage.get_backend.return_value.exists.return_value = True
        db = MagicMock()
        db.execute.return_value.scalar_one_or_none.return_value = custom_map
        db.execute.return_value.scalar_one.return_value = 0  # nothing in flight

        result = service.complete_upload(db, 1, custom_map.id)

        assert result.status == STATUS_PROCESSING
        assert result.error_message is None
        mock_spawn.assert_called_once_with(custom_map.id)
        db.commit.assert_called_once()

    @patch("src.custom_maps.service._spawn_worker")
    @patch("src.custom_maps.service.storage")
    def test_503_when_concurrency_cap_reached(self, mock_storage, mock_spawn):
        custom_map = _make_custom_map(status=STATUS_PENDING, campaign_id=1)
        mock_storage.get_backend.return_value.exists.return_value = True
        db = MagicMock()
        db.execute.return_value.scalar_one_or_none.return_value = custom_map
        db.execute.return_value.scalar_one.return_value = service.MAX_CONCURRENT_PROCESSING

        with pytest.raises(HTTPException) as exc:
            service.complete_upload(db, 1, custom_map.id)
        assert exc.value.status_code == 503
        mock_spawn.assert_not_called()

    @patch("src.custom_maps.service._spawn_worker")
    @patch("src.custom_maps.service.storage")
    def test_400_when_blob_not_uploaded(self, mock_storage, mock_spawn):
        custom_map = _make_custom_map(status=STATUS_PENDING, campaign_id=1)
        mock_storage.get_backend.return_value.exists.return_value = False
        db = MagicMock()
        db.execute.return_value.scalar_one_or_none.return_value = custom_map

        with pytest.raises(HTTPException) as exc:
            service.complete_upload(db, 1, custom_map.id)
        assert exc.value.status_code == 400
        mock_spawn.assert_not_called()

    @patch("src.custom_maps.service._spawn_worker")
    def test_idempotent_when_already_ready(self, mock_spawn):
        custom_map = _make_custom_map(status=STATUS_READY, campaign_id=1)
        db = MagicMock()
        db.execute.return_value.scalar_one_or_none.return_value = custom_map

        result = service.complete_upload(db, 1, custom_map.id)
        assert result.status == STATUS_READY
        mock_spawn.assert_not_called()

    @patch("src.custom_maps.service._spawn_worker")
    @patch("src.custom_maps.service.storage")
    def test_failed_custom_maps_can_be_retried(self, mock_storage, mock_spawn):
        custom_map = _make_custom_map(status=STATUS_FAILED, error_message="prior failure")
        mock_storage.get_backend.return_value.exists.return_value = True
        db = MagicMock()
        db.execute.return_value.scalar_one_or_none.return_value = custom_map
        db.execute.return_value.scalar_one.return_value = 0

        result = service.complete_upload(db, 1, custom_map.id)
        assert result.status == STATUS_PROCESSING
        assert result.error_message is None
        mock_spawn.assert_called_once()


class TestDelete:
    @patch("src.custom_maps.service.storage")
    def test_removes_blobs_and_row(self, mock_storage):
        custom_map = _make_custom_map(
            status=STATUS_READY,
            source_path="campaigns/1/custom-maps/x/source.tif",
            cog_path="campaigns/1/custom-maps/x/cog.tif",
        )
        db = MagicMock()
        db.execute.return_value.scalar_one_or_none.return_value = custom_map

        service.delete(db, 1, custom_map.id)

        db.delete.assert_called_once_with(custom_map)
        db.commit.assert_called_once()
        # Both source + COG blobs cleaned up
        backend = mock_storage.get_backend.return_value
        paths = [c.args[0] for c in backend.delete.call_args_list]
        assert "campaigns/1/custom-maps/x/source.tif" in paths
        assert "campaigns/1/custom-maps/x/cog.tif" in paths

    @patch("src.custom_maps.service.storage")
    def test_skips_cog_delete_when_unset(self, mock_storage):
        custom_map = _make_custom_map(status=STATUS_PENDING, cog_path=None)
        db = MagicMock()
        db.execute.return_value.scalar_one_or_none.return_value = custom_map
        service.delete(db, 1, custom_map.id)
        backend = mock_storage.get_backend.return_value
        assert backend.delete.call_count == 1


class TestUpdate:
    def test_patches_name_and_display_order(self):
        custom_map = _make_custom_map(name="old", display_order=0)
        db = MagicMock()
        db.execute.return_value.scalar_one_or_none.return_value = custom_map

        result = service.update(db, 1, custom_map.id, name="new", display_order=3)
        assert result.name == "new"
        assert result.display_order == 3
        db.commit.assert_called_once()

    def test_ignores_none_fields(self):
        custom_map = _make_custom_map(name="unchanged", display_order=5)
        db = MagicMock()
        db.execute.return_value.scalar_one_or_none.return_value = custom_map
        result = service.update(db, 1, custom_map.id, name=None, display_order=None)
        assert result.name == "unchanged"
        assert result.display_order == 5


class TestPruneStalePending:
    @patch("src.custom_maps.service.storage")
    def test_deletes_stale_pending_and_their_blobs(self, mock_storage):
        old = _make_custom_map(
            status=STATUS_PENDING,
            source_path="campaigns/1/custom-maps/old/source.tif",
        )
        old.created_at = datetime.now(UTC) - timedelta(
            minutes=service.STALE_PENDING_AFTER_MINUTES + 1
        )
        db = MagicMock()
        db.execute.return_value.scalars.return_value.all.return_value = [old]

        service._prune_stale_pending(db, 1)

        mock_storage.get_backend.return_value.delete.assert_called_once_with(
            "campaigns/1/custom-maps/old/source.tif"
        )
        db.delete.assert_called_once_with(old)
        db.commit.assert_called_once()

    @patch("src.custom_maps.service.storage")
    def test_noop_when_no_stale_rows(self, mock_storage):
        db = MagicMock()
        db.execute.return_value.scalars.return_value.all.return_value = []
        service._prune_stale_pending(db, 1)
        mock_storage.get_backend.assert_not_called()
        db.delete.assert_not_called()
        db.commit.assert_not_called()


class TestSourceBlockBudget:
    """Reject sources whose smallest possible read would blow the RAM budget."""

    def _src(self, *, block_shapes, dtypes, count, is_tiled, compression):
        s = MagicMock()
        s.block_shapes = block_shapes
        s.dtypes = dtypes
        s.count = count
        s.is_tiled = is_tiled
        s.compression = compression
        return s

    def test_small_tiled_passes(self):
        from src.custom_maps.process import _check_source_block_budget

        src = self._src(
            block_shapes=[(512, 512)],
            dtypes=["uint8"],
            count=3,
            is_tiled=True,
            compression="DEFLATE",
        )
        _check_source_block_budget(src)  # no raise

    def test_uncompressed_striped_bypasses_check(self):
        from src.custom_maps.process import _check_source_block_budget

        # Pathologically huge single strip but uncompressed → GDAL seeks within.
        src = self._src(
            block_shapes=[(100_000, 100_000)],
            dtypes=["float32"],
            count=4,
            is_tiled=False,
            compression=None,
        )
        _check_source_block_budget(src)  # no raise

    def test_compressed_single_strip_rejected(self):
        from src.custom_maps.process import _check_source_block_budget

        # 50k × 50k × uint8 × 1 band = ~2.5 GiB > 1 GiB budget
        src = self._src(
            block_shapes=[(50_000, 50_000)],
            dtypes=["uint8"],
            count=1,
            is_tiled=False,
            compression="DEFLATE",
        )
        with pytest.raises(RuntimeError, match="compressed strip"):
            _check_source_block_budget(src)

    def test_huge_tile_rejected(self):
        from src.custom_maps.process import _check_source_block_budget

        # 16384² × float32 × 4 bands = 4 GiB tile
        src = self._src(
            block_shapes=[(16384, 16384)],
            dtypes=["float32"],
            count=4,
            is_tiled=True,
            compression="DEFLATE",
        )
        with pytest.raises(RuntimeError, match="tile"):
            _check_source_block_budget(src)

    def test_uses_largest_block_across_bands(self):
        from src.custom_maps.process import _check_source_block_budget

        # First band is small, second band is the problem.
        src = self._src(
            block_shapes=[(256, 256), (50_000, 50_000)],
            dtypes=["uint8"],
            count=1,
            is_tiled=True,
            compression="DEFLATE",
        )
        with pytest.raises(RuntimeError):
            _check_source_block_budget(src)
