import json

import pytest
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
    layer = existing_layer(9, "overlay-1")
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

    layer = campaign.register_overlay(
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
        json=[existing_layer(1, "overlay-1"), existing_layer(2, "some custom overlay")],
    )
    responses.post(f"{BASE}/api/campaigns/42/custom-maps", json=created_layer(), status=201)

    campaign.register_overlay("https://blob/preds.tif")

    assert posted_body()["name"] == "overlay-3"
    assert posted_body()["mlops_url"] is None


@responses.activate
def test_default_name_skips_taken_names():
    campaign = make_campaign()
    responses.get(
        f"{BASE}/api/campaigns/42/custom-maps",
        json=[existing_layer(1, "overlay-1"), existing_layer(2, "overlay-3")],
    )
    responses.post(f"{BASE}/api/campaigns/42/custom-maps", json=created_layer(), status=201)

    campaign.register_overlay("https://blob/preds.tif")

    assert posted_body()["name"] == "overlay-4"


@responses.activate
def test_categorical_classes_build_legend_entries():
    campaign = make_campaign()
    responses.get(f"{BASE}/api/campaigns/42/custom-maps", json=[])
    responses.post(f"{BASE}/api/campaigns/42/custom-maps", json=created_layer(), status=201)

    campaign.register_overlay(
        "https://blob/preds.tif",
        classes={1: "Crop", 0: "Non-crop"},
    )

    config = posted_body()["render_config"]
    assert config["mode"] == "categorical"
    assert [e["value"] for e in config["entries"]] == [0, 1]
    assert [e["label"] for e in config["entries"]] == ["Non-crop", "Crop"]
    colors = [e["color"] for e in config["entries"]]
    assert len(set(colors)) == 2
    assert all(c.startswith("#") for c in colors)


@responses.activate
def test_categorical_classes_with_explicit_colors():
    campaign = make_campaign()
    responses.get(f"{BASE}/api/campaigns/42/custom-maps", json=[])
    responses.post(f"{BASE}/api/campaigns/42/custom-maps", json=created_layer(), status=201)

    campaign.register_overlay(
        "https://blob/preds.tif",
        classes={0: ("Non-crop", "#d95f02"), 1: ("Crop", "#1b9e77")},
    )

    entries = posted_body()["render_config"]["entries"]
    assert entries == [
        {"value": 0, "label": "Non-crop", "color": "#d95f02"},
        {"value": 1, "label": "Crop", "color": "#1b9e77"},
    ]


@responses.activate
def test_overlays_dataframe():
    campaign = make_campaign()
    responses.get(
        f"{BASE}/api/campaigns/42/custom-maps",
        json=[existing_layer(1, "overlay-1")],
    )

    df = campaign.overlays()

    assert list(df.columns) == ["id", "name", "cog_url", "status", "mlops_url", "tile_url"]
    assert df.loc[0, "name"] == "overlay-1"


@responses.activate
def test_overlays_empty_keeps_columns():
    campaign = make_campaign()
    responses.get(f"{BASE}/api/campaigns/42/custom-maps", json=[])

    df = campaign.overlays()

    assert df.empty
    assert list(df.columns) == ["id", "name", "cog_url", "status", "mlops_url", "tile_url"]


@responses.activate
def test_register_rejects_local_file_paths():
    campaign = make_campaign()

    with pytest.raises(ValueError, match="local path"):
        campaign.register_overlay("/home/me/predictions.tif")


@responses.activate
def test_register_accepts_tiler_local_cog_paths():
    campaign = make_campaign()
    responses.get(f"{BASE}/api/campaigns/42/custom-maps", json=[])
    responses.post(
        f"{BASE}/api/campaigns/42/custom-maps",
        json=created_layer(cog_url="/data/cogs/predictions.cog.tif"),
        status=201,
    )

    campaign.register_overlay("/data/cogs/predictions.cog.tif")

    assert posted_body()["cog_url"] == "/data/cogs/predictions.cog.tif"


def vector_layer(layer_id, name):
    return {
        "id": layer_id,
        "campaign_id": 42,
        "name": name,
        "pmtiles_url": f"https://blob/layer_{layer_id}.pmtiles",
        "source_layer": None,
        "color": "#3b82f6",
        "display_order": 0,
    }


def posted_vector_body():
    post_call = next(c for c in responses.calls if c.request.method == "POST")
    return json.loads(post_call.request.body)


@responses.activate
def test_register_vector_overlay_posts_payload():
    campaign = make_campaign()
    responses.get(f"{BASE}/api/campaigns/42/vector-layers", json=[])
    responses.post(
        f"{BASE}/api/campaigns/42/vector-layers",
        json=vector_layer(3, "field boundaries"),
        status=201,
    )

    layer = campaign.register_vector_overlay(
        "https://blob/fields.pmtiles",
        name="field boundaries",
        source_layer="fields",
        color="#ff0000",
    )

    body = posted_vector_body()
    assert body == {
        "name": "field boundaries",
        "pmtiles_url": "https://blob/fields.pmtiles",
        "source_layer": "fields",
        "color": "#ff0000",
    }
    assert layer["id"] == 3


@responses.activate
def test_register_vector_overlay_default_name_skips_taken():
    campaign = make_campaign()
    responses.get(
        f"{BASE}/api/campaigns/42/vector-layers",
        json=[vector_layer(1, "vector-overlay-1"), vector_layer(2, "vector-overlay-3")],
    )
    responses.post(
        f"{BASE}/api/campaigns/42/vector-layers",
        json=vector_layer(4, "vector-overlay-4"),
        status=201,
    )

    campaign.register_vector_overlay("https://blob/fields.pmtiles")

    assert posted_vector_body()["name"] == "vector-overlay-4"


@responses.activate
def test_register_vector_overlay_rejects_local_paths():
    campaign = make_campaign()

    with pytest.raises(ValueError, match="local path"):
        campaign.register_vector_overlay("/home/me/fields.pmtiles")


@responses.activate
def test_vector_overlays_dataframe():
    campaign = make_campaign()
    responses.get(
        f"{BASE}/api/campaigns/42/vector-layers",
        json=[vector_layer(1, "field boundaries")],
    )

    df = campaign.vector_overlays()

    assert list(df.columns) == ["id", "name", "pmtiles_url", "source_layer", "color"]
    assert df.loc[0, "name"] == "field boundaries"


@responses.activate
def test_vector_overlays_empty_keeps_columns():
    campaign = make_campaign()
    responses.get(f"{BASE}/api/campaigns/42/vector-layers", json=[])

    df = campaign.vector_overlays()

    assert df.empty
    assert list(df.columns) == ["id", "name", "pmtiles_url", "source_layer", "color"]


def test_class_colors_curated_for_small_counts():
    from stacnotator.campaign import _class_colors

    colors = _class_colors(5)
    assert colors == ["#1b9e77", "#d95f02", "#7570b3", "#e7298a", "#66a61e"]


def test_class_colors_distinguishable_for_many_classes():
    from stacnotator.campaign import _class_colors

    def rgb(color):
        return tuple(int(color[i : i + 2], 16) for i in (1, 3, 5))

    for n, floor in ((30, 70), (100, 20)):
        colors = _class_colors(n)
        assert len(set(colors)) == n
        assert all(len(c) == 7 and c.startswith("#") for c in colors)
        pairs = [(rgb(a), rgb(b)) for i, a in enumerate(colors) for b in colors[i + 1 :]]
        min_dist = min(sum(abs(x - y) for x, y in zip(a, b, strict=True)) for a, b in pairs)
        assert min_dist >= floor, f"n={n}: min pairwise distance {min_dist} < {floor}"


def test_class_colors_unique_up_to_256():
    from stacnotator.campaign import _class_colors

    colors = _class_colors(256)
    assert len(set(colors)) == 256


@responses.activate
def test_register_overlay_rejects_more_than_256_classes():
    campaign = make_campaign()
    classes = {i: f"class-{i}" for i in range(257)}

    with pytest.raises(ValueError, match="256"):
        campaign.register_overlay("https://blob/preds.tif", classes=classes)


@responses.activate
def test_register_overlay_rejects_unsupported_colormap():
    campaign = make_campaign()

    with pytest.raises(ValueError, match="coolwarm.*viridis"):
        campaign.register_overlay("https://blob/preds.tif", colormap="coolwarm")
