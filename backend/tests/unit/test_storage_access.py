"""A private catalog's SAS token: accepted only read-only and time-limited, kept encrypted
and write-only, sent only to the catalog's host, and handed to the tiler sealed."""

import base64
import logging
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from pydantic import ValidationError

from src import crypto, storage_access
from src.imagery import registration
from src.imagery.models import CollectionStacConfig
from src.imagery.schemas import CollectionStacConfigCreate, CollectionStacConfigOut
from src.redact import install_log_redaction, redact_urls
from src.stac_browser import client as stac_client
from src.storage_access import AZURE_SAS, StorageAccess

CATALOG = "https://acct.blob.core.windows.net/imagery/catalog.json"
FUTURE = (datetime.now(UTC) + timedelta(days=6)).strftime("%Y-%m-%dT%H:%M:%SZ")
SAS = f"sv=2024-11-04&sr=c&sp=r&se={FUTURE}&spr=https&sig=SECRET"


@pytest.fixture(autouse=True)
def keys(monkeypatch):
    key = base64.b64encode(b"k" * 32).decode()
    settings = SimpleNamespace(APIKEY_ENCRYPTION_SECRET=key, TILER_TOKEN_SECRET="t" * 40)
    monkeypatch.setattr(crypto, "get_settings", lambda: settings)
    monkeypatch.setattr(storage_access, "get_settings", lambda: settings)


def sas(**overrides) -> str:
    params = dict(p.split("=", 1) for p in SAS.split("&"))
    params.update(overrides)
    return "&".join(f"{k}={v}" for k, v in params.items() if v is not None)


def test_a_read_only_container_sas_is_accepted_with_its_expiry():
    access = storage_access.AzureSasAccess(kind=AZURE_SAS, secret=f"?{SAS}")
    assert access.secret == SAS
    assert storage_access.sas_expiry(SAS) > datetime.now(UTC)


@pytest.mark.parametrize(
    "token",
    [
        CATALOG + "?" + SAS,  # a URL, not just the token
        sas(sig=None),
        sas(sp="rw"),
        sas(sp="racwdl"),
        sas(ss="b", srt="sco"),  # account SAS
        sas(spr="https,http"),
        sas(se=None),
        sas(se=(datetime.now(UTC) - timedelta(hours=1)).strftime("%Y-%m-%dT%H:%M:%SZ")),
    ],
)
def test_anything_broader_or_unbounded_is_refused(token):
    with pytest.raises(ValidationError):
        storage_access.AzureSasAccess(kind=AZURE_SAS, secret=token)


def test_only_a_catalog_on_azure_blob_over_https_takes_a_sas():
    storage_access.check_catalog(CATALOG)
    for url in ("http://acct.blob.core.windows.net/c/catalog.json", "https://example.com/c.json"):
        with pytest.raises(storage_access.InvalidStorageAccess):
            storage_access.check_catalog(url)


def test_the_token_goes_only_to_the_catalogs_own_host():
    access = StorageAccess(AZURE_SAS, SAS)
    item = "https://acct.blob.core.windows.net/imagery/items/a.json"
    assert storage_access.apply(item, CATALOG, access) == f"{item}?{SAS}"
    for elsewhere in (
        "https://other.blob.core.windows.net/x/a.json",
        "https://planetarycomputer.microsoft.com/api/stac/v1",
        "http://acct.blob.core.windows.net/imagery/a.json",
    ):
        assert storage_access.apply(elsewhere, CATALOG, access) == elsewhere
    assert storage_access.apply(item, CATALOG, None) == item


def _row() -> CollectionStacConfig:
    return CollectionStacConfig(
        collection_id=1, catalog_url=CATALOG, stac_collection_id="c", internal_storage=False
    )


def test_stored_encrypted_described_without_the_secret_and_kept_when_left_out():
    row = _row()
    assert storage_access.store(row, storage_access.AzureSasAccess(kind=AZURE_SAS, secret=SAS))
    assert "SECRET" not in (row.encrypted_storage_secret or "")
    assert storage_access.stored(row).secret == SAS

    out = CollectionStacConfigOut.model_validate(row).model_dump_json()
    assert "SECRET" not in out and '"kind":"azure_sas"' in out

    assert not storage_access.store(row, None)
    assert storage_access.stored(row).secret == SAS


def test_sealed_for_the_tiler_opens_only_with_the_tiler_key_and_host():
    sealed = storage_access.seal_for_tiler(StorageAccess(AZURE_SAS, SAS), CATALOG)
    assert "SECRET" not in str(sealed)
    assert sealed["host"] == "acct.blob.core.windows.net"

    # What the tiler's storage_access.unseal does with the same shared secret.
    key = HKDF(
        algorithm=hashes.SHA256(), length=32, salt=None, info=b"stacnotator:storage-access:v1"
    ).derive(b"t" * 40)
    raw = base64.b64decode(sealed["secret"])
    aad = f"{sealed['kind']}|{sealed['host']}".encode()
    assert AESGCM(key).decrypt(raw[:12], raw[12:], aad).decode() == SAS
    with pytest.raises(Exception):  # noqa: B017 - any failure: wrong host must not open
        AESGCM(key).decrypt(raw[:12], raw[12:], b"azure_sas|evil.example.com")


def test_a_saved_collection_payload_never_needs_the_token_again():
    config = CollectionStacConfigCreate(catalog_url=CATALOG, stac_collection_id="c")
    assert config.storage_access is None


# --- registration ---


def test_private_catalog_slice_ingests_with_access_and_searches_its_own_collection(monkeypatch):
    calls = {}

    def ingest(*args, **kwargs):
        calls["ingest"] = kwargs
        return SimpleNamespace(collection="c-0123abcd", count=3)

    def register(tiler, body, scope, **kwargs):
        calls["register"] = (body, kwargs)
        return "search-1"

    monkeypatch.setattr(registration.providers, "ingest_on_tiler", ingest)
    monkeypatch.setattr(registration.providers, "register_on_tiler", register)
    stac = SimpleNamespace(
        catalog_url=CATALOG, stac_collection_id="c", max_cloud_cover=None, internal_storage=False
    )
    slice_ = SimpleNamespace(start_date="2024-01-01", end_date="2024-01-31")
    query = {"collections": ["c"], "filter-lang": "cql2-json"}

    out = registration._register_hosted_slice(
        stac,
        slice_,
        [0, 0, 1, 1],
        query,
        "42",
        SimpleNamespace(allows_ingest=True),
        StorageAccess(AZURE_SAS, SAS),
    )

    assert out == "search-1"
    assert calls["ingest"]["storage_access"] == {"kind": AZURE_SAS, "secret": SAS}
    body, kwargs = calls["register"]
    assert body["collections"] == ["c-0123abcd"]
    assert "SECRET" not in str(kwargs["sealed_storage_access"])
    assert "internal_storage" not in kwargs


# --- browsing ---


def test_catalog_reads_carry_the_token_only_to_the_catalog_host(monkeypatch):
    requested = []

    class _Resp:
        status_code = 200
        content = b"{}"

    monkeypatch.setattr(
        stac_client.GuardedStacIO._http,
        "get",
        lambda url, params=None, headers=None: requested.append(url) or _Resp(),
    )
    io = stac_client.GuardedStacIO(CATALOG, StorageAccess(AZURE_SAS, SAS))
    io.request("https://acct.blob.core.windows.net/imagery/collection.json")
    io.request("https://example.com/elsewhere.json")

    assert requested == [
        f"https://acct.blob.core.windows.net/imagery/collection.json?{SAS}",
        "https://example.com/elsewhere.json",
    ]


def test_private_items_come_back_without_thumbnails():
    item = SimpleNamespace(
        id="a",
        datetime=None,
        bbox=None,
        geometry=None,
        properties={},
        assets={
            "thumbnail": SimpleNamespace(
                href="https://acct.blob.core.windows.net/t.png",
                media_type="image/png",
                title=None,
                roles=[],
            )
        },
        get_self_href=lambda: "https://acct.blob.core.windows.net/imagery/items/a.json",
    )
    assert stac_client._simplify_item(item)["thumbnail"].endswith("t.png")
    assert stac_client._simplify_item(item, private=True)["thumbnail"] is None


# --- logs ---


def test_tokens_in_log_messages_and_tracebacks_are_redacted(caplog):
    assert redact_urls(f"GET {CATALOG}?{SAS} failed") == f"GET {CATALOG}?<redacted> failed"

    previous = logging.getLogRecordFactory()
    install_log_redaction()
    try:
        logger = logging.getLogger("test.redact")
        try:
            raise OSError(f"403 for {CATALOG}?{SAS}")
        except OSError:
            logger.exception("read failed for %s?%s", CATALOG, SAS)
    finally:
        logging.setLogRecordFactory(previous)

    assert "SECRET" not in caplog.text
    assert "<redacted>" in caplog.text


# --- visualizers ---


def test_a_visualizer_cannot_register_a_private_catalog_of_its_own():
    from fastapi import HTTPException

    from src.imagery import service as imagery_service
    from src.imagery.schemas import ImagerySourceCreate

    source = ImagerySourceCreate.model_validate(
        {
            "name": "private",
            "visualizations": [{"name": "RGB"}],
            "collections": [
                {
                    "name": "2024",
                    "slices": [],
                    "stac_config": {
                        "catalog_url": CATALOG,
                        "stac_collection_id": "c",
                        "storage_access": {"kind": AZURE_SAS, "secret": SAS},
                    },
                }
            ],
        }
    )
    with pytest.raises(HTTPException) as exc:
        imagery_service.save_visualizer_imagery(
            None, visualizer=None, sources=[source], bbox=[0, 0, 1, 1]
        )
    assert exc.value.status_code == 400
