"""Storage abstraction for the worker (mirrors backend/src/imagery/storage.py)."""

import shutil
from abc import ABC, abstractmethod
from datetime import datetime, timedelta, timezone
from pathlib import Path

from src.config import get_settings


class ObjectStorage(ABC):
    @abstractmethod
    def get_accessible_path(self, key: str) -> str:
        """Return a local path or HTTP URL the worker can read from."""

    @abstractmethod
    def upload(self, key: str, local_path: str) -> None:
        """Upload a local file to the given storage key."""

    @abstractmethod
    def delete(self, key: str) -> None: ...


class LocalStorage(ObjectStorage):
    def __init__(self, base_path: str) -> None:
        self.base_path = Path(base_path)

    def get_accessible_path(self, key: str) -> str:
        return str(self.base_path / key)

    def upload(self, key: str, local_path: str) -> None:
        dest = self.base_path / key
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(local_path, dest)

    def delete(self, key: str) -> None:
        path = self.base_path / key
        if path.exists():
            path.unlink()


class AzureStorage(ObjectStorage):
    """Uses DefaultAzureCredential - works with Managed Identity, Azure CLI, etc."""

    def __init__(self, account_url: str, container: str) -> None:
        from azure.identity import DefaultAzureCredential
        from azure.storage.blob import BlobServiceClient

        self._container = container
        self._account_url = account_url
        self._client = BlobServiceClient(
            account_url=account_url, credential=DefaultAzureCredential()
        )

    def _read_sas_url(self, key: str, expiry_hours: int = 2) -> str:
        from azure.storage.blob import BlobSasPermissions, generate_blob_sas

        expiry = datetime.now(timezone.utc) + timedelta(hours=expiry_hours)
        delegation_key = self._client.get_user_delegation_key(
            key_start_time=datetime.now(timezone.utc),
            key_expiry_time=expiry,
        )
        sas = generate_blob_sas(
            account_name=self._client.account_name,
            container_name=self._container,
            blob_name=key,
            user_delegation_key=delegation_key,
            permission=BlobSasPermissions(read=True),
            expiry=expiry,
        )
        return f"{self._account_url}/{self._container}/{key}?{sas}"

    def get_accessible_path(self, key: str) -> str:
        return self._read_sas_url(key)

    def upload(self, key: str, local_path: str) -> None:
        blob = self._client.get_blob_client(container=self._container, blob=key)
        with open(local_path, "rb") as f:
            blob.upload_blob(f, overwrite=True)

    def delete(self, key: str) -> None:
        blob = self._client.get_blob_client(container=self._container, blob=key)
        try:
            blob.delete_blob(delete_snapshots="include")
        except Exception:
            pass


def get_storage() -> ObjectStorage:
    s = get_settings()
    if s.STORAGE_PROVIDER == "azure":
        return AzureStorage(
            account_url=s.AZURE_STORAGE_ACCOUNT_URL,
            container=s.AZURE_STORAGE_CONTAINER,
        )
    return LocalStorage(base_path=s.STORAGE_LOCAL_PATH)
