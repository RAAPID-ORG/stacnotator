"""A customer's own access to the storage their STAC catalog lives in.

Today that is an Azure SAS token for the container. The admin pastes it once while adding
a private catalog; it is then used for every read of that catalog - browsing it here,
ingesting it on the tiler, and the tiler's tile reads - and only ever sent to the one host
the catalog URL is on, never to anything else the catalog links to.

It is write-only like a provider key: stored encrypted (``crypto.py``), reported back only
as its kind and expiry. For tile reads the tiler gets it sealed into the search metadata
(``seal_for_tiler``), under a key both services derive from ``TILER_TOKEN_SECRET``; the
tiler's ``storage_access.py`` is the other half of that contract.

``kind`` exists so another way of reading private storage can be added beside the SAS
without changing the columns, the API shape or the tiler contract.
"""

import base64
import os
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Annotated, Literal, Protocol
from urllib.parse import parse_qs, urlparse

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from pydantic import BaseModel, Field, field_validator

from src.config import get_settings
from src.crypto import decrypt, encrypt

AZURE_SAS = "azure_sas"
AZURE_BLOB_SUFFIX = ".blob.core.windows.net"

_READ_ONLY = set("rl")
_TILER_HKDF_INFO = b"stacnotator:storage-access:v1"
_NONCE_BYTES = 12


class InvalidStorageAccess(ValueError):
    pass


def sas_expiry(token: str) -> datetime:
    """Check an Azure SAS token is read-only and time-limited; return when it expires."""
    if "://" in token:
        raise InvalidStorageAccess("Paste only the SAS token, not a URL")
    query = parse_qs(token.removeprefix("?"), keep_blank_values=True)
    if "sig" not in query:
        raise InvalidStorageAccess("This is not a SAS token: it has no signature (sig)")
    if "ss" in query or "srt" in query:
        raise InvalidStorageAccess(
            "Account SAS tokens are not accepted; create one for the container instead"
        )
    permissions = set(query.get("sp", [""])[0])
    if not permissions or not permissions <= _READ_ONLY:
        raise InvalidStorageAccess("The SAS token must grant read (and optionally list) only")
    if query.get("spr", ["https"])[0] != "https":
        raise InvalidStorageAccess("The SAS token must be limited to HTTPS")
    expiry = query.get("se", [""])[0]
    if not expiry:
        raise InvalidStorageAccess("The SAS token must have an expiry (se)")
    try:
        expires_at = datetime.fromisoformat(expiry)
    except ValueError:
        raise InvalidStorageAccess("The SAS token's expiry (se) is not a valid date") from None
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=UTC)
    if expires_at <= datetime.now(UTC):
        raise InvalidStorageAccess("This SAS token has already expired")
    return expires_at


class AzureSasAccess(BaseModel):
    kind: Literal["azure_sas"]
    secret: str = Field(min_length=1)

    @field_validator("secret")
    @classmethod
    def read_only_and_time_limited(cls, value: str) -> str:
        value = value.strip().removeprefix("?")
        sas_expiry(value)
        return value


# One member today; another kind is one more model here, told apart by ``kind``.
StorageAccessCreate = Annotated[AzureSasAccess, Field(discriminator="kind")]


class StorageAccessOut(BaseModel):
    kind: str
    expires_at: datetime | None = None


@dataclass(frozen=True)
class StorageAccess:
    """An access in the clear, for the duration of the reads that need it."""

    kind: str
    secret: str
    expires_at: datetime | None = None

    @classmethod
    def of(cls, incoming: AzureSasAccess) -> "StorageAccess":
        return cls(incoming.kind, incoming.secret, sas_expiry(incoming.secret))

    def tiler_body(self) -> dict:
        """The access as the tiler's ``/ingest`` takes it."""
        return {"kind": self.kind, "secret": self.secret}


def host_of(url: str) -> str:
    return (urlparse(url).hostname or "").lower()


def check_catalog(catalog_url: str | None) -> None:
    """A SAS only makes sense for a catalog on Azure Blob, read over HTTPS."""
    parsed = urlparse(catalog_url or "")
    if parsed.scheme != "https" or not host_of(catalog_url or "").endswith(AZURE_BLOB_SUFFIX):
        raise InvalidStorageAccess(
            "A SAS token can only be used with a catalog on Azure Blob Storage (https)"
        )


def apply(url: str, catalog_url: str, access: StorageAccess | None) -> str:
    """``url`` readable with ``access`` when it is on the catalog's own host, else unchanged."""
    if access is None:
        return url
    parsed = urlparse(url)
    if parsed.scheme != "https" or host_of(url) != host_of(catalog_url):
        return url
    return f"{url}{'&' if parsed.query else '?'}{access.secret}"


class _HasStorageColumns(Protocol):
    storage_auth: str | None
    encrypted_storage_secret: str | None
    storage_secret_expires_at: datetime | None


def store(row: _HasStorageColumns, incoming: AzureSasAccess | None) -> bool:
    """Put a newly provided access on the row; an entry without one keeps the stored one
    (it is never read back, so a saved collection always arrives without it). Returns
    whether the access changed."""
    if incoming is None:
        return False
    access = StorageAccess.of(incoming)
    row.storage_auth = access.kind
    row.encrypted_storage_secret = encrypt(access.secret)
    row.storage_secret_expires_at = access.expires_at
    return True


def stored(row: _HasStorageColumns | None) -> StorageAccess | None:
    if row is None or not row.storage_auth or not row.encrypted_storage_secret:
        return None
    return StorageAccess(
        row.storage_auth, decrypt(row.encrypted_storage_secret), row.storage_secret_expires_at
    )


def described(row: _HasStorageColumns | None) -> StorageAccessOut | None:
    if row is None or not row.storage_auth:
        return None
    return StorageAccessOut(kind=row.storage_auth, expires_at=row.storage_secret_expires_at)


def _tiler_key() -> bytes:
    secret = get_settings().TILER_TOKEN_SECRET.encode()
    return HKDF(algorithm=hashes.SHA256(), length=32, salt=None, info=_TILER_HKDF_INFO).derive(
        secret
    )


def seal_for_tiler(access: StorageAccess, catalog_url: str) -> dict:
    """The access as a search's metadata carries it: only the tiler can open it, and only
    for the catalog's host (kind and host are bound into the ciphertext)."""
    host = host_of(catalog_url)
    nonce = os.urandom(_NONCE_BYTES)
    ciphertext = AESGCM(_tiler_key()).encrypt(
        nonce, access.secret.encode(), f"{access.kind}|{host}".encode()
    )
    return {
        "kind": access.kind,
        "host": host,
        "secret": base64.b64encode(nonce + ciphertext).decode(),
        "expires_at": access.expires_at.isoformat() if access.expires_at else None,
    }
