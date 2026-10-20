"""Specification: a campaign collection may reference a managed cloud catalog (issue #158).

The reference is ``cloud_collection_id``; the catalog URL, pgstac collection, tiler and
storage access are derived server-side (``resolve_managed_collection``), so a client must
not be able to smuggle any of them in beside the reference. Visualizations stay ordinary
per-campaign copies: there is no link back to the catalog's presets.
"""

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
