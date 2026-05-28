"""Read-only signed-URL builder mirroring backend/src/storage."""

from __future__ import annotations

import hashlib
import hmac
import threading
import time
from datetime import datetime, timedelta, timezone

from src.config import get_settings

_OP_READ = "r"
_READ_TTL_MINUTES = 60

# Cached user-delegation key (Azure-only). Rotated hourly.
_DELEGATION_KEY_TTL = timedelta(hours=1)
_DELEGATION_RENEW_MARGIN = timedelta(minutes=5)
_azure_state = {
    "service_client": None,
    "delegation_key": None,
    "delegation_key_expiry": datetime.min.replace(tzinfo=timezone.utc),
    "lock": threading.Lock(),
}


def generate_read_url(path: str) -> str:
    settings = get_settings()
    if settings.STORAGE_BACKEND.lower() == "azure":
        return _azure_sas_read(path)
    return _local_signed_read(path)


def _azure_sas_read(path: str) -> str:
    from azure.storage.blob import BlobSasPermissions, generate_blob_sas

    settings = get_settings()
    account = settings.AZURE_STORAGE_ACCOUNT_NAME
    container = settings.AZURE_STORAGE_CONTAINER
    if not account:
        raise RuntimeError("STORAGE_BACKEND=azure requires AZURE_STORAGE_ACCOUNT_NAME")

    expiry = datetime.now(timezone.utc) + timedelta(minutes=_READ_TTL_MINUTES)
    sas = generate_blob_sas(
        account_name=account,
        container_name=container,
        blob_name=path,
        user_delegation_key=_user_delegation_key(account),
        permission=BlobSasPermissions(read=True),
        expiry=expiry,
    )
    return f"https://{account}.blob.core.windows.net/{container}/{path}?{sas}"


def _user_delegation_key(account: str):
    now = datetime.now(timezone.utc)
    with _azure_state["lock"]:
        if (
            _azure_state["delegation_key"] is None
            or now >= _azure_state["delegation_key_expiry"] - _DELEGATION_RENEW_MARGIN
        ):
            client = _azure_service_client(account)
            start = now - timedelta(minutes=5)
            expiry = now + _DELEGATION_KEY_TTL
            _azure_state["delegation_key"] = client.get_user_delegation_key(start, expiry)
            _azure_state["delegation_key_expiry"] = expiry
        return _azure_state["delegation_key"]


def _azure_service_client(account: str):
    if _azure_state["service_client"] is None:
        from azure.identity import DefaultAzureCredential
        from azure.storage.blob import BlobServiceClient

        _azure_state["service_client"] = BlobServiceClient(
            account_url=f"https://{account}.blob.core.windows.net",
            credential=DefaultAzureCredential(),
        )
    return _azure_state["service_client"]


def _local_signed_read(path: str) -> str:
    settings = get_settings()
    expiry = int(time.time()) + _READ_TTL_MINUTES * 60
    payload = f"{_OP_READ}:{expiry}:{path}"
    sig = hmac.new(
        settings.TILER_TOKEN_SECRET.encode(), payload.encode(), hashlib.sha256
    ).hexdigest()
    token = f"{_OP_READ}.{expiry}.{sig}"
    base = settings.STORAGE_LOCAL_INTERNAL_BASE.rstrip("/")
    return f"{base}/api/local-blob/{token}/{path}"
