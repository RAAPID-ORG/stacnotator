"""Custom indices through the service against real PostgreSQL: series find their index
by name through the view-only join, edits and renames carry the series along, and
nothing is left pointing at an index that is gone."""

import os
from uuid import uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy.orm import Session

from src.campaigns.duplication import duplicate_campaign
from src.campaigns.models import Campaign
from src.campaigns.schemas import CampaignOut
from src.campaigns.service import get_campaign_full
from src.database import engine
from src.organizations.models import Organization
from src.projects.models import Project
from src.timeseries import service
from src.timeseries.schemas import CustomIndexIn, TimeseriesCreate, TimeseriesOut

pytestmark = pytest.mark.skipif(
    os.environ.get("CUSTOM_INDEX_DATABASE_TESTS") != "1",
    reason="Set CUSTOM_INDEX_DATABASE_TESTS=1 against a migrated PostgreSQL database",
)

CIRE = CustomIndexIn(
    name="CIre", expression="nir / rededge1 - 1", domain_min=0, domain_max=10, reference_lines=[2]
)


def _series(ts_type: str, data_source: str = "SENTINEL2") -> TimeseriesCreate:
    return TimeseriesCreate(
        name=f"{ts_type} series",
        start_ym="202301",
        end_ym="202312",
        data_source=data_source,
        ts_type=ts_type,
    )


@pytest.fixture
def campaign_db():
    with engine.connect() as connection, connection.begin() as transaction:
        with Session(bind=connection, join_transaction_mode="create_savepoint") as db:
            organization = Organization(name=f"Index test {uuid4()}", status="approved")
            db.add(organization)
            db.flush()
            project = Project(name="Index test", organization_id=organization.id)
            db.add(project)
            db.flush()
            campaign = Campaign(
                project_id=project.id,
                name="Index test",
                bbox_west=-10,
                bbox_south=-10,
                bbox_east=10,
                bbox_north=10,
                sample_extent_meters=100,
                labels=[{"id": 1, "name": "Forest", "geometry_type": "point"}],
            )
            db.add(campaign)
            db.commit()
            yield db, campaign
        transaction.rollback()


def _saved(db: Session, campaign: Campaign) -> CampaignOut:
    db.expire_all()
    return CampaignOut.model_validate(get_campaign_full(db, campaign.id))


def test_a_series_plots_its_custom_index_and_follows_edits(campaign_db):
    db, campaign = campaign_db
    service.create_custom_index(db, campaign.id, CIRE)
    service.create_timeseries_bulk(campaign.id, [_series("CIre"), _series("NDVI")], db)

    out = _saved(db, campaign)
    assert [index.key for index in out.custom_indices] == ["CIre"]
    assert out.custom_indices[0].source_keys == ["SENTINEL2"]
    charted = {series.ts_type: series.index for series in out.time_series}
    assert charted["CIre"].formula == "NIR / RedEdge1 - 1"
    assert charted["NDVI"].label == "NDVI"

    edited = CIRE.model_copy(
        update={"name": "CIred", "expression": "nir / rededge1", "domain_max": 8}
    )
    service.update_custom_index(db, campaign.id, "CIre", edited)

    out = _saved(db, campaign)
    assert [index.key for index in out.custom_indices] == ["CIred"]
    series = next(s for s in out.time_series if s.name == "CIre series")
    assert series.ts_type == "CIred"
    assert (series.index.formula, series.index.domain_max) == ("NIR / RedEdge1", 8)


def test_an_edit_its_series_sources_cannot_compute_is_refused(campaign_db):
    db, campaign = campaign_db
    ndti = CustomIndexIn(
        name="NDTI", expression="(swir1 - swir2) / (swir1 + swir2)", domain_min=-1, domain_max=1
    )
    service.create_custom_index(db, campaign.id, ndti)
    service.create_timeseries_bulk(campaign.id, [_series("NDTI", "LANDSAT")], db)

    red_edge = ndti.model_copy(update={"expression": "swir1 / rededge1"})
    with pytest.raises(HTTPException) as refused:
        service.update_custom_index(db, campaign.id, "NDTI", red_edge)
    assert refused.value.status_code == 422

    db.rollback()
    assert _saved(db, campaign).custom_indices[0].expression == ndti.expression


def test_a_series_cannot_name_an_index_its_source_lacks_the_bands_for(campaign_db):
    db, campaign = campaign_db
    service.create_custom_index(db, campaign.id, CIRE)
    with pytest.raises(HTTPException) as refused:
        service.create_timeseries_bulk(campaign.id, [_series("CIre", "MODIS")], db)
    assert refused.value.status_code == 422


def test_names_are_unique_in_a_campaign(campaign_db):
    db, campaign = campaign_db
    service.create_custom_index(db, campaign.id, CIRE)
    with pytest.raises(HTTPException) as refused:
        service.create_custom_index(db, campaign.id, CIRE)
    assert refused.value.status_code == 409


def test_an_index_in_use_is_kept_until_its_series_goes(campaign_db):
    db, campaign = campaign_db
    service.create_custom_index(db, campaign.id, CIRE)
    [series] = service.create_timeseries_bulk(campaign.id, [_series("CIre")], db)

    with pytest.raises(HTTPException) as refused:
        service.delete_custom_index(db, campaign.id, "CIre")
    assert refused.value.status_code == 409

    service.delete_timeseries(series.id, campaign.id, db)
    service.delete_custom_index(db, campaign.id, "CIre")
    assert _saved(db, campaign).custom_indices == []


def test_a_duplicated_campaign_brings_its_indices(campaign_db):
    db, campaign = campaign_db
    service.create_custom_index(db, campaign.id, CIRE)
    service.create_timeseries_bulk(campaign.id, [_series("CIre")], db)

    copy = duplicate_campaign(
        db,
        get_campaign_full(db, campaign.id),
        include_tasks=False,
        include_annotations=False,
        include_user_layouts=False,
    )
    db.commit()

    out = _saved(db, copy)
    assert [index.key for index in out.custom_indices] == ["CIre"]
    [series] = out.time_series
    assert TimeseriesOut.model_validate(series).index.formula == "NIR / RedEdge1 - 1"
