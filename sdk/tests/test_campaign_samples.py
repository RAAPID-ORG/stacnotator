import pandas as pd
import pytest
import responses

from stacnotator._credentials import Credentials, save
from stacnotator.client import Client

BASE = "https://app.example.org"

CAMPAIGN_PAYLOAD = {
    "id": 42,
    "name": "Crop mapping",
    "mode": "open",
    "settings": {"labels": [{"id": 1, "name": "Maize", "geometry_type": "point"}]},
}


def geojson(*features):
    return {"type": "FeatureCollection", "features": list(features)}


def point_feature(annotation_id, lon=13.4, lat=52.5, label_id=1):
    return {
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [lon, lat]},
        "properties": {
            "stacnotator_annotation_id": annotation_id,
            "stacnotator_task_id": None,
            "stacnotator_label_id": label_id,
            "stacnotator_label_name": "Maize",
            "stacnotator_confidence": None,
            "stacnotator_created_by_user_email": "a@b.c",
            "stacnotator_created_at": "2026-06-01T10:00:00+00:00",
        },
    }


def make_campaign():
    save(Credentials(url=BASE, auth={"mode": "none"}))
    responses.get(f"{BASE}/api/campaigns/42", json=CAMPAIGN_PAYLOAD)
    return Client().campaign(42)


@responses.activate
def test_get_samples_fetches_geojson_export():
    campaign = make_campaign()
    responses.get(
        f"{BASE}/api/campaigns/42/export-annotations-geojson",
        json=geojson(point_feature(1), point_feature(2)),
    )

    df = campaign.get_samples()

    assert df["annotation_id"].tolist() == [1, 2]
    export_call = responses.calls[-1]
    assert "merge_on_agreement=false" in export_call.request.url


@responses.activate
def test_get_samples_merge_on_agreement_flag():
    campaign = make_campaign()
    responses.get(f"{BASE}/api/campaigns/42/export-annotations-geojson", json=geojson())

    campaign.get_samples(merge_on_agreement=True)

    assert "merge_on_agreement=true" in responses.calls[-1].request.url


@responses.activate
def test_update_samples_appends_only_new_annotations():
    campaign = make_campaign()
    responses.get(
        f"{BASE}/api/campaigns/42/export-annotations-geojson",
        json=geojson(point_feature(1)),
    )
    training_set = campaign.get_samples()
    responses.get(
        f"{BASE}/api/campaigns/42/export-annotations-geojson",
        json=geojson(point_feature(1), point_feature(2), point_feature(3)),
    )

    updated = campaign.update_samples(training_set)

    assert updated["annotation_id"].tolist() == [1, 2, 3]
    assert len(training_set) == 1


@responses.activate
def test_update_samples_without_new_rows_returns_equal_frame():
    campaign = make_campaign()
    responses.get(
        f"{BASE}/api/campaigns/42/export-annotations-geojson",
        json=geojson(point_feature(1), point_feature(2)),
    )
    training_set = campaign.get_samples()
    responses.get(
        f"{BASE}/api/campaigns/42/export-annotations-geojson",
        json=geojson(point_feature(1), point_feature(2)),
    )

    updated = campaign.update_samples(training_set)

    pd.testing.assert_frame_equal(updated, training_set)


@responses.activate
def test_update_samples_with_empty_frame_fetches_everything():
    campaign = make_campaign()
    responses.get(
        f"{BASE}/api/campaigns/42/export-annotations-geojson",
        json=geojson(point_feature(7)),
    )

    updated = campaign.update_samples(pd.DataFrame())

    assert updated["annotation_id"].tolist() == [7]


@responses.activate
def test_update_samples_preserves_user_added_columns():
    campaign = make_campaign()
    responses.get(
        f"{BASE}/api/campaigns/42/export-annotations-geojson",
        json=geojson(point_feature(1)),
    )
    training_set = campaign.get_samples()
    training_set["embedding"] = [[0.1, 0.2]]
    responses.get(
        f"{BASE}/api/campaigns/42/export-annotations-geojson",
        json=geojson(point_feature(1), point_feature(2)),
    )

    updated = campaign.update_samples(training_set)

    assert "embedding" in updated.columns
    assert updated.loc[updated["annotation_id"] == 1, "embedding"].iloc[0] == [0.1, 0.2]
    assert pd.isna(updated.loc[updated["annotation_id"] == 2, "embedding"].iloc[0])


@responses.activate
def test_update_samples_requires_annotation_id_column():
    campaign = make_campaign()
    frame_without_ids = pd.DataFrame({"lat": [52.5], "lon": [13.4]})

    with pytest.raises(ValueError, match="annotation_id"):
        campaign.update_samples(frame_without_ids)
