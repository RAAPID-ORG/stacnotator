from __future__ import annotations

import logging
import threading
from datetime import UTC, datetime, timedelta
from pathlib import Path

from src.config import get_settings
from src.storage.base import StorageBackend

logger = logging.getLogger(__name__)

# User-delegation key TTL. Azure caps at 7 days; we rotate hourly so the
# in-memory window for any leaked key stays small.
_DELEGATION_KEY_TTL = timedelta(hours=1)
_DELEGATION_RENEW_MARGIN = timedelta(minutes=5)


class AzureBlobStorage(StorageBackend):
    name = "azure"

    def __init__(self) -> None:
        settings = get_settings()
        if not settings.AZURE_STORAGE_ACCOUNT_NAME:
            raise RuntimeError("STORAGE_BACKEND=azure requires AZURE_STORAGE_ACCOUNT_NAME")
        self._account = settings.AZURE_STORAGE_ACCOUNT_NAME
        self._container = settings.AZURE_STORAGE_CONTAINER
        self._service_client = None
        self._delegation_key = None
        self._delegation_key_expiry = datetime.min.replace(tzinfo=UTC)
        self._lock = threading.Lock()

    def generate_upload_url(self, path: str, ttl_minutes: int = 30) -> str:
        from azure.storage.blob import BlobSasPermissions

        return self._sas(path, BlobSasPermissions(write=True, create=True), ttl_minutes)

    def generate_read_url(self, path: str, ttl_minutes: int = 60) -> str:
        from azure.storage.blob import BlobSasPermissions

        return self._sas(path, BlobSasPermissions(read=True), ttl_minutes)

    def _sas(self, path: str, perms, ttl_minutes: int) -> str:
        from azure.storage.blob import generate_blob_sas

        expiry = datetime.now(UTC) + timedelta(minutes=ttl_minutes)
        sas = generate_blob_sas(
            account_name=self._account,
            container_name=self._container,
            blob_name=path,
            user_delegation_key=self._user_delegation_key(),
            permission=perms,
            expiry=expiry,
        )
        return f"https://{self._account}.blob.core.windows.net/{self._container}/{path}?{sas}"

    def exists(self, path: str) -> bool:
        return self._client(path).exists()

    def delete(self, path: str) -> None:
        try:
            self._client(path).delete_blob()
        except Exception:
            logger.warning("Failed to delete blob %s", path, exc_info=True)

    def download_to(self, path: str, local_path: str | Path) -> None:
        local_path = Path(local_path)
        local_path.parent.mkdir(parents=True, exist_ok=True)
        with open(local_path, "wb") as f:
            stream = self._client(path).download_blob(max_concurrency=4)
            stream.readinto(f)

    def upload_from(self, local_path: str | Path, path: str) -> None:
        with open(local_path, "rb") as f:
            self._client(path).upload_blob(f, overwrite=True, max_concurrency=4)

    def _get_service_client(self):
        if self._service_client is None:
            from azure.identity import DefaultAzureCredential
            from azure.storage.blob import BlobServiceClient

            self._service_client = BlobServiceClient(
                account_url=f"https://{self._account}.blob.core.windows.net",
                credential=DefaultAzureCredential(),
            )
        return self._service_client

    def _client(self, path: str):
        return self._get_service_client().get_blob_client(self._container, path)

    def _user_delegation_key(self):
        now = datetime.now(UTC)
        with self._lock:
            if (
                self._delegation_key is None
                or now >= self._delegation_key_expiry - _DELEGATION_RENEW_MARGIN
            ):
                # 5 min back-skew margin for clients with slightly slow clocks.
                start = now - timedelta(minutes=5)
                expiry = now + _DELEGATION_KEY_TTL
                self._delegation_key = self._get_service_client().get_user_delegation_key(
                    start, expiry
                )
                self._delegation_key_expiry = expiry
            return self._delegation_key
