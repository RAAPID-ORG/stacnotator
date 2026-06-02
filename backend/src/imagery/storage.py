"""Object storage abstraction for custom map uploads.

Local dev: files stored on a shared volume (backend + tiler + worker all mount it).
Production: Azure Blob Storage using DefaultAzureCredential (Managed Identity,
Azure CLI, etc.) with user-delegation SAS - no account keys needed.
"""

import contextlib
from abc import ABC, abstractmethod
from datetime import UTC, datetime, timedelta
from functools import lru_cache
from pathlib import Path

from src.config import get_settings


class ObjectStorage(ABC):
    @abstractmethod
    def get_accessible_url(self, key: str) -> str:
        """Return a URL or local path the worker/tiler can read."""

    @abstractmethod
    def delete(self, key: str) -> None:
        """Delete the object at key. Silently succeeds if not found."""


class LocalStorage(ObjectStorage):
    def __init__(self, base_path: str) -> None:
        self.base_path = Path(base_path)

    def save(self, key: str, content: bytes) -> None:
        dest = self.base_path / key
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(content)

    def get_accessible_url(self, key: str) -> str:
        return str(self.base_path / key)

    def delete(self, key: str) -> None:
        path = self.base_path / key
        if path.exists():
            path.unlink()


class AzureStorage(ObjectStorage):
    """Azure Blob Storage using DefaultAzureCredential.

    Works with Managed Identity, Azure CLI login, environment credentials, etc.
    Requires the identity to have 'Storage Blob Data Contributor' on the container.

    Generates client upload URLs via user-delegation SAS — no account keys needed.
    """

    def __init__(self, account_url: str, container: str) -> None:
        from azure.identity import DefaultAzureCredential
        from azure.storage.blob import BlobServiceClient

        self._container = container
        self._account_url = account_url
        self._client = BlobServiceClient(
            account_url=account_url, credential=DefaultAzureCredential()
        )

    def _sas_url(self, key: str, write: bool = False) -> str:
        from azure.storage.blob import BlobSasPermissions, generate_blob_sas

        expiry = datetime.now(UTC) + timedelta(hours=1)
        delegation_key = self._client.get_user_delegation_key(
            key_start_time=datetime.now(UTC),
            key_expiry_time=expiry,
        )
        permission = (
            BlobSasPermissions(write=True, create=True) if write else BlobSasPermissions(read=True)
        )
        sas = generate_blob_sas(
            account_name=self._client.account_name,
            container_name=self._container,
            blob_name=key,
            user_delegation_key=delegation_key,
            permission=permission,
            expiry=expiry,
        )
        return f"{self._account_url}/{self._container}/{key}?{sas}"

    def upload_url(self, key: str) -> tuple[str, str]:
        """Return (url, http_method) for a direct client PUT upload."""
        return self._sas_url(key, write=True), "PUT"

    def get_accessible_url(self, key: str) -> str:
        return self._sas_url(key, write=False)

    def delete(self, key: str) -> None:
        blob = self._client.get_blob_client(container=self._container, blob=key)
        with contextlib.suppress(Exception):
            blob.delete_blob(delete_snapshots="include")


@lru_cache
def get_storage() -> ObjectStorage:
    s = get_settings()
    if s.STORAGE_PROVIDER == "azure":
        return AzureStorage(
            account_url=s.AZURE_STORAGE_ACCOUNT_URL,
            container=s.AZURE_STORAGE_CONTAINER,
        )
    return LocalStorage(base_path=s.STORAGE_LOCAL_PATH)
