import pystac

from src.tiling.stac_client import _asset_defs_from_item


def _item(assets: dict) -> pystac.Item:
    return pystac.Item.from_dict(
        {
            "type": "Feature",
            "stac_version": "1.0.0",
            "id": "it1",
            "geometry": {"type": "Point", "coordinates": [0, 0]},
            "bbox": [0, 0, 0, 0],
            "properties": {"datetime": "2024-01-01T00:00:00Z"},
            "links": [],
            "assets": assets,
        }
    )


def test_derives_asset_type_and_roles():
    item = _item(
        {
            "visual": {
                "href": "https://x/v.tif",
                "type": "image/tiff; application=geotiff; profile=cloud-optimized",
                "roles": ["visual"],
                "title": "RGB",
            }
        }
    )
    defs = _asset_defs_from_item(item)
    assert set(defs) == {"visual"}
    assert defs["visual"]["type"].startswith("image/tiff")
    assert defs["visual"]["roles"] == ["visual"]
    assert defs["visual"]["title"] == "RGB"
    assert defs["visual"]["bands"] == []


def test_expands_eo_bands_in_order():
    item = _item(
        {
            "data": {
                "href": "https://x/d.tif",
                "type": "image/tiff; application=geotiff",
                "eo:bands": [{"name": "red"}, {"name": "nir", "description": "near IR"}],
            }
        }
    )
    bands = _asset_defs_from_item(item)["data"]["bands"]
    assert [b["name"] for b in bands] == ["red", "nir"]
    assert bands[1]["description"] == "near IR"


def test_falls_back_to_key_as_title():
    defs = _asset_defs_from_item(_item({"b1": {"href": "https://x/b.tif"}}))
    assert defs["b1"]["title"] == "b1"
