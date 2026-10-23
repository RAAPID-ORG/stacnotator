"""Specification: a campaign collection may reference a managed cloud catalog (issue #158).

The reference is ``cloud_collection_id``; the catalog URL, pgstac collection, tiler and
storage access are derived server-side (``resolve_managed_collection``), so a client must
not be able to smuggle any of them in beside the reference. Visualizations stay ordinary
per-campaign copies: there is no link back to the catalog's presets.
"""

from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from src.imagery.schemas import CollectionStacConfigCreate

SAS = {"kind": "azure_sas", "secret": "sp=rl&se=2099-01-01&spr=https&sig=x"}


def test_managed_reference_is_accepted_alone_with_visualization_copies():
    config = CollectionStacConfigCreate(
        cloud_collection_id=5,
        visualizations=[{"name": "RGB", "viz_params": {"assets": ["data"], "bidx": [1, 2, 3]}}],
    )
    assert config.cloud_collection_id == 5
    assert config.visualizations[0].viz_params.bidx == [1, 2, 3]


@pytest.mark.parametrize("internal_url", ["http://tiler:8000/", None])
def test_catalog_requests_use_internal_tiler_address_when_configured(monkeypatch, internal_url):
    import json

    import httpx

    from src.config import TilerCfg, get_settings
    from src.tilers import catalogs

    public_url = "https://tiles.example.com/"
    monkeypatch.setattr(
        get_settings(),
        "tilers_raw",
        json.dumps({"hosted": TilerCfg(url=public_url, internal_url=internal_url).model_dump()}),
    )
    requested = []

    def get(url, **kwargs):
        requested.append(url)
        return httpx.Response(
            200, json={"version": 1, "providers": ["azure_blob"], "max_batch_items": 100}
        )

    monkeypatch.setattr(catalogs.httpx, "get", get)
    assert catalogs.capabilities("hosted")["providers"] == ["azure_blob"]
    assert requested == [f"{(internal_url or public_url).rstrip('/')}/catalogs/capabilities"]


@pytest.mark.parametrize(
    "bypass",
    [
        {"catalog_url": "https://evil.example.com/stac"},
        {"stac_collection_id": "cc-" + "a" * 32},
        {"tiler": "hosted"},
        {"storage_access": SAS},
        {"internal_storage": True},
    ],
    ids=["catalog url", "pgstac collection", "tiler", "storage access", "internal storage"],
)
def test_managed_reference_rejects_client_supplied_catalog_fields(bypass):
    with pytest.raises(ValidationError):
        CollectionStacConfigCreate(cloud_collection_id=5, **bypass)


MANAGED = "cc-" + "a" * 32
OTHER_MANAGED = "cc-" + "b" * 32
SECRET = "sp=rl&se=2099-01-01T00:00:00Z&spr=https&sv=2022-11-02&sr=c&sig=TOPSECRET"


@pytest.mark.parametrize(
    "search_query",
    [
        {"collections": [OTHER_MANAGED], "filter-lang": "cql2-json"},
        {"collections": ["sentinel-2-l2a", OTHER_MANAGED]},
        {
            "filter-lang": "cql2-json",
            "filter": {"op": "=", "args": [{"property": "collection"}, OTHER_MANAGED]},
        },
    ],
    ids=["collections list", "collections mixed in", "cql2 collection filter"],
)
@pytest.mark.parametrize("field", ["search_query", "cover_search_query"])
def test_custom_search_query_cannot_select_a_managed_catalog_collection(field, search_query):
    with pytest.raises(ValidationError):
        CollectionStacConfigCreate(
            catalog_url="https://tiler.test/stac",
            stac_collection_id="sentinel-2-l2a",
            tiler="hosted",
            **{field: search_query},
        )


class _Session:
    """Stands in for the DB session only; the helper and schemas under test run for real."""

    def __init__(self, sources):
        self.sources, self.deleted = sources, []

    def execute(self, _stmt):
        return SimpleNamespace(scalars=lambda: SimpleNamespace(all=lambda: self.sources))

    def delete(self, row):
        self.deleted.append(row)


def test_reregistering_a_managed_collection_keeps_its_reference_and_resolved_access():
    from src import storage_access
    from src.imagery.models import (
        CollectionStacConfig,
        ImageryCollection,
        ImagerySlice,
        ImagerySource,
        SliceTileUrl,
    )
    from src.imagery.registration import prepare_stac_reregistration

    container = "https://acct.blob.core.windows.net/flights"
    stac = CollectionStacConfig(
        catalog_url=container,
        stac_collection_id=MANAGED,
        tile_provider="hosted",
        search_query={"filter-lang": "cql2-json"},
        internal_storage=False,
        cloud_collection_id=7,
    )
    storage_access.store(stac, storage_access.AzureSasAccess(kind="azure_sas", secret=SECRET))
    old_tile = SliceTileUrl()
    collection = ImageryCollection(
        id=1, name="Jan", has_dedicated_cover=False, cover_slice_index=0, stac_config=stac
    )
    collection.slices = [
        ImagerySlice(start_date="2026-01-01", end_date="2026-01-31", tile_urls=[old_tile])
    ]
    db = _Session([ImagerySource(collections=[collection])])

    [spec] = prepare_stac_reregistration(db, campaign_id=1)

    assert spec.stac_config.cloud_collection_id == 7
    assert spec.stac_config.stac_collection_id == MANAGED
    assert spec.stac_config.catalog_url == container
    assert spec.stac_config.tiler == "hosted"
    assert spec.storage_access is not None and spec.storage_access.secret == SECRET
    assert db.deleted == [old_tile]
