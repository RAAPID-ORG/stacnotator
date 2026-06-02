"""Unit tests for the custom map router endpoints."""

import uuid
from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException

from src.imagery.custom_map_router import (
    CustomMapCreate,
    VizParamsUpdate,
    create_custom_map,
    delete_custom_map,
    list_custom_maps,
    request_upload,
    update_viz_params,
    upload_local,
)
from src.imagery.models import CustomMap


def _mock_db():
    db = MagicMock()
    return db


def _mock_campaign(campaign_id=1):
    campaign = MagicMock()
    campaign.id = campaign_id
    return campaign


def _mock_user(user_id=None):
    user = MagicMock()
    user.id = user_id or uuid.uuid4()
    return user


def _make_custom_map(map_id=None, campaign_id=1, name="My Map", status="pending_processing"):
    m = MagicMock(spec=CustomMap)
    m.id = map_id or uuid.uuid4()
    m.campaign_id = campaign_id
    m.name = name
    m.status = status
    m.original_key = f"campaigns/{campaign_id}/custom-maps/{m.id}.tif"
    m.cog_key = None
    m.band_count = None
    m.nodata = None
    m.bounds = None
    m.viz_params = None
    m.error = None
    return m


class TestRequestUpload:
    def test_local_returns_backend_url(self):
        campaign = _mock_campaign(campaign_id=42)

        with patch("src.imagery.custom_map_router.get_settings") as mock_settings:
            mock_settings.return_value.STORAGE_PROVIDER = "local"
            result = request_upload(campaign_id=42, campaign=campaign)

        assert "upload_url" in result
        assert result["method"] == "POST"
        assert "/custom-maps/upload-local" in result["upload_url"]
        assert "key" in result
        assert result["key"].startswith("campaigns/42/")
        assert result["key"].endswith(".tif")

    def test_azure_returns_sas_url(self):
        campaign = _mock_campaign(campaign_id=42)
        mock_storage = MagicMock()
        mock_storage.generate_upload_url.return_value = (
            "https://account.blob.core.windows.net/c/k?sas",
            "PUT",
        )

        with (
            patch("src.imagery.custom_map_router.get_settings") as mock_settings,
            patch("src.imagery.custom_map_router.get_storage", return_value=mock_storage),
        ):
            mock_settings.return_value.STORAGE_PROVIDER = "azure"
            result = request_upload(campaign_id=42, campaign=campaign)

        assert result["method"] == "PUT"
        assert result["upload_url"].startswith("https://")
        mock_storage.generate_upload_url.assert_called_once()

    def test_key_scoped_to_campaign(self):
        campaign = _mock_campaign(campaign_id=7)

        with patch("src.imagery.custom_map_router.get_settings") as mock_settings:
            mock_settings.return_value.STORAGE_PROVIDER = "local"
            result = request_upload(campaign_id=7, campaign=campaign)

        assert result["key"].startswith("campaigns/7/")


class TestUploadLocal:
    def test_rejects_non_local_storage(self):
        campaign = _mock_campaign(campaign_id=1)
        file = MagicMock()

        import asyncio

        with patch("src.imagery.custom_map_router.get_settings") as mock_settings:
            mock_settings.return_value.STORAGE_PROVIDER = "azure"

            with pytest.raises(HTTPException) as exc_info:
                asyncio.get_event_loop().run_until_complete(
                    upload_local(
                        campaign_id=1,
                        key="campaigns/1/custom-maps/abc.tif",
                        file=file,
                        campaign=campaign,
                    )
                )

        assert exc_info.value.status_code == 400

    def test_rejects_key_for_wrong_campaign(self):
        """Key not scoped to the campaign_id must be rejected."""
        campaign = _mock_campaign(campaign_id=1)
        file = MagicMock()

        import asyncio

        from src.imagery.storage import LocalStorage

        real_local = LocalStorage.__new__(LocalStorage)
        real_local.base_path = "/tmp"

        with (
            patch("src.imagery.custom_map_router.get_settings") as mock_settings,
            patch("src.imagery.custom_map_router.get_storage", return_value=real_local),
        ):
            mock_settings.return_value.STORAGE_PROVIDER = "local"

            with pytest.raises(HTTPException) as exc_info:
                asyncio.get_event_loop().run_until_complete(
                    upload_local(
                        campaign_id=1,
                        key="campaigns/99/custom-maps/abc.tif",  # wrong campaign
                        file=file,
                        campaign=campaign,
                    )
                )

        assert exc_info.value.status_code == 400


class TestCreateCustomMap:
    def test_creates_record_with_pending_status(self):
        db = _mock_db()
        campaign = _mock_campaign(campaign_id=3)
        user = _mock_user()
        body = CustomMapCreate(name="DEM", key="campaigns/3/custom-maps/abc.tif", viz_params=None)

        create_custom_map(campaign_id=3, body=body, campaign=campaign, user=user, db=db)

        db.add.assert_called_once()
        added: CustomMap = db.add.call_args[0][0]
        assert added.name == "DEM"
        assert added.status == "pending_processing"
        assert added.campaign_id == 3
        assert added.original_key == "campaigns/3/custom-maps/abc.tif"

    def test_rejects_key_for_wrong_campaign(self):
        db = _mock_db()
        campaign = _mock_campaign(campaign_id=3)
        user = _mock_user()
        body = CustomMapCreate(name="DEM", key="campaigns/99/custom-maps/abc.tif", viz_params=None)

        with pytest.raises(HTTPException) as exc_info:
            create_custom_map(campaign_id=3, body=body, campaign=campaign, user=user, db=db)

        assert exc_info.value.status_code == 400

    def test_stores_viz_params(self):
        db = _mock_db()
        campaign = _mock_campaign(campaign_id=5)
        user = _mock_user()
        viz = {"assets": ["1", "2", "3"], "rescale": "0,255"}
        body = CustomMapCreate(name="RGB", key="campaigns/5/custom-maps/abc.tif", viz_params=viz)

        create_custom_map(campaign_id=5, body=body, campaign=campaign, user=user, db=db)

        added: CustomMap = db.add.call_args[0][0]
        assert added.viz_params == viz


class TestListCustomMaps:
    def test_filters_by_campaign_id(self):
        """Listing must scope results to the campaign; a different campaign's maps must not appear."""
        db = _mock_db()
        campaign = _mock_campaign(campaign_id=2)
        db.query.return_value.filter_by.return_value.order_by.return_value.all.return_value = []

        list_custom_maps(campaign_id=2, campaign=campaign, db=db)

        # Must filter by the exact campaign_id - passing a different id would be a security hole
        db.query.return_value.filter_by.assert_called_once_with(campaign_id=2)

    def test_does_not_filter_by_other_campaign(self):
        """Ensure campaign_id=3 is not substituted for campaign_id=2."""
        db = _mock_db()
        campaign_2 = _mock_campaign(campaign_id=2)
        campaign_3 = _mock_campaign(campaign_id=3)
        db.query.return_value.filter_by.return_value.order_by.return_value.all.return_value = []

        list_custom_maps(campaign_id=2, campaign=campaign_2, db=db)
        list_custom_maps(campaign_id=3, campaign=campaign_3, db=db)

        calls = db.query.return_value.filter_by.call_args_list
        assert calls[0] == ((), {"campaign_id": 2})
        assert calls[1] == ((), {"campaign_id": 3})


class TestUpdateVizParams:
    def test_updates_viz_params(self):
        db = _mock_db()
        campaign = _mock_campaign(campaign_id=1)
        map_id = uuid.uuid4()
        custom_map = _make_custom_map(map_id=map_id)
        db.query.return_value.filter_by.return_value.first.return_value = custom_map
        body = VizParamsUpdate(viz_params={"assets": ["1"], "rescale": "0,100"})

        update_viz_params(campaign_id=1, map_id=map_id, body=body, campaign=campaign, db=db)

        assert custom_map.viz_params == {"assets": ["1"], "rescale": "0,100"}
        db.commit.assert_called_once()

    def test_raises_404_when_not_found(self):
        db = _mock_db()
        campaign = _mock_campaign(campaign_id=1)
        db.query.return_value.filter_by.return_value.first.return_value = None
        body = VizParamsUpdate(viz_params={})

        with pytest.raises(HTTPException) as exc_info:
            update_viz_params(
                campaign_id=1, map_id=uuid.uuid4(), body=body, campaign=campaign, db=db
            )

        assert exc_info.value.status_code == 404


class TestDeleteCustomMap:
    def test_deletes_record_and_storage(self):
        db = _mock_db()
        campaign = _mock_campaign(campaign_id=1)
        map_id = uuid.uuid4()
        custom_map = _make_custom_map(map_id=map_id)
        custom_map.cog_key = "campaigns/1/custom-maps/abc.cog.tif"
        db.query.return_value.filter_by.return_value.first.return_value = custom_map
        mock_storage = MagicMock()

        with patch("src.imagery.custom_map_router.get_storage", return_value=mock_storage):
            delete_custom_map(campaign_id=1, map_id=map_id, campaign=campaign, db=db)

        assert mock_storage.delete.call_count == 2  # original + cog
        db.delete.assert_called_once_with(custom_map)
        db.commit.assert_called_once()

    def test_raises_404_when_not_found(self):
        db = _mock_db()
        campaign = _mock_campaign(campaign_id=1)
        db.query.return_value.filter_by.return_value.first.return_value = None

        with pytest.raises(HTTPException) as exc_info:
            delete_custom_map(campaign_id=1, map_id=uuid.uuid4(), campaign=campaign, db=db)

        assert exc_info.value.status_code == 404

    def test_storage_error_does_not_propagate(self):
        """Storage delete errors are swallowed so the DB record is still removed."""
        db = _mock_db()
        campaign = _mock_campaign(campaign_id=1)
        map_id = uuid.uuid4()
        custom_map = _make_custom_map(map_id=map_id)
        custom_map.cog_key = None
        db.query.return_value.filter_by.return_value.first.return_value = custom_map
        mock_storage = MagicMock()
        mock_storage.delete.side_effect = Exception("blob not found")

        with patch("src.imagery.custom_map_router.get_storage", return_value=mock_storage):
            # Should not raise
            delete_custom_map(campaign_id=1, map_id=map_id, campaign=campaign, db=db)

        db.delete.assert_called_once_with(custom_map)
