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
