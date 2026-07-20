import pystac

from src.tiling.stac_client import _collection_out, _unavailable_collection


def _collection(extra: dict | None = None) -> pystac.Collection:
    d = {
        "type": "Collection",
        "stac_version": "1.0.0",
        "id": "s2",
        "description": "Sentinel-2",
        "license": "proprietary",
        "extent": {
            "spatial": {"bbox": [[-180, -90, 180, 90]]},
            "temporal": {"interval": [["2020-01-01T00:00:00Z", None]]},
        },
        "links": [],
        **(extra or {}),
    }
    return pystac.Collection.from_dict(d)


def test_valid_collection_is_selectable():
    out = _collection_out(_collection({"title": "S2 L2A"}))
    assert out["id"] == "s2"
    assert out["title"] == "S2 L2A"
    assert out["selectable"] is True
    assert out["unavailable_reason"] is None
    assert out["temporal_extent"]["start"].startswith("2020-01-01")


def test_missing_stac_version_is_surfaced_not_hidden():
    # earthgenome's sentinel2-yearly-embeddings ships without stac_version, which
    # pystac can't parse. We must still surface it, disabled, with the reason.
    raw = {"id": "yearly-embeddings", "title": "Yearly embeddings", "description": "d"}
    out = _unavailable_collection(raw, ValueError("boom"))
    assert out["id"] == "yearly-embeddings"
    assert out["title"] == "Yearly embeddings"
    assert out["selectable"] is False
    assert "stac_version" in out["unavailable_reason"]


def test_other_parse_error_gets_generic_reason():
    raw = {"id": "broken", "stac_version": "1.0.0"}
    out = _unavailable_collection(raw, ValueError("boom"))
    assert out["selectable"] is False
    assert "stac_version" not in out["unavailable_reason"]
    assert out["title"] == "broken"  # falls back to id when title missing
