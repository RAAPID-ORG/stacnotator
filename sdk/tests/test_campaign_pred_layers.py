import json

import responses

from stacnotator._credentials import Credentials, save
from stacnotator.client import Client

BASE = "https://app.example.org"

CAMPAIGN_PAYLOAD = {"id": 42, "name": "Crop mapping", "mode": "open", "settings": {"labels": []}}


def existing_layer(layer_id, name):
    return {
        "id": layer_id,
        "campaign_id": 42,
        "name": name,
        "cog_url": f"https://blob/preds_{layer_id}.tif",
        "render_config": {"mode": "continuous", "band": 1},
        "max_native_zoom": None,
        "status": "ready",
        "status_error": None,
        "tile_url": "https://tiler/x/{z}/{x}/{y}",
        "mosaic_id": "abc",
        "display_order": 0,
        "mlops_url": None,
    }


def created_layer(**overrides):
    layer = existing_layer(9, "prediction-1")
    layer.update(status="registering", tile_url=None, mosaic_id=None, **overrides)
    return layer


def make_campaign():
    save(Credentials(url=BASE, auth={"mode": "none"}))
    responses.get(f"{BASE}/api/campaigns/42", json=CAMPAIGN_PAYLOAD)
    return Client().campaign(42)


def posted_body():
    post_call = next(c for c in responses.calls if c.request.method == "POST")
    return json.loads(post_call.request.body)


@responses.activate
def test_register_with_explicit_name_and_mlops_link():
    campaign = make_campaign()
    responses.get(f"{BASE}/api/campaigns/42/custom-maps", json=[])
    responses.post(
        f"{BASE}/api/campaigns/42/custom-maps",
        json=created_layer(name="preds v3", mlops_url="https://mlflow/#/experiments/7"),
        status=201,
    )

    layer = campaign.register_pred_layer(
        "https://blob/preds_v3.tif",
        name="preds v3",
        mlops_link="https://mlflow/#/experiments/7",
    )

    body = posted_body()
    assert body["name"] == "preds v3"
    assert body["cog_url"] == "https://blob/preds_v3.tif"
    assert body["mlops_url"] == "https://mlflow/#/experiments/7"
    assert body["render_config"] == {
        "mode": "continuous",
        "band": 1,
        "colormap_name": "viridis",
        "rescale": [0.0, 1.0],
    }
    assert layer["id"] == 9
    assert layer["status"] == "registering"


@responses.activate
def test_default_name_uses_increasing_counter():
    campaign = make_campaign()
    responses.get(
        f"{BASE}/api/campaigns/42/custom-maps",
        json=[existing_layer(1, "prediction-1"), existing_layer(2, "some custom overlay")],
    )
    responses.post(f"{BASE}/api/campaigns/42/custom-maps", json=created_layer(), status=201)

    campaign.register_pred_layer("https://blob/preds.tif")

    assert posted_body()["name"] == "prediction-3"
    assert posted_body()["mlops_url"] is None


@responses.activate
def test_pred_layers_dataframe():
    campaign = make_campaign()
    responses.get(
        f"{BASE}/api/campaigns/42/custom-maps",
        json=[existing_layer(1, "prediction-1")],
    )

    df = campaign.pred_layers()

    assert list(df.columns) == ["id", "name", "cog_url", "status", "mlops_url", "tile_url"]
    assert df.loc[0, "name"] == "prediction-1"


@responses.activate
def test_pred_layers_empty_keeps_columns():
    campaign = make_campaign()
    responses.get(f"{BASE}/api/campaigns/42/custom-maps", json=[])

    df = campaign.pred_layers()

    assert df.empty
    assert list(df.columns) == ["id", "name", "cog_url", "status", "mlops_url", "tile_url"]
