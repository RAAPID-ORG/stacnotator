"""The workspace in an Azure Blob container, shared by the backend and its workers.

Records and files are blobs under the same keys the local workspace uses as
paths. A blob overwrite is one PUT, so a record is never seen half-written.
GDAL reads sources and products in place through ``/vsiaz/`` with range
requests, authorised by a user-delegation SAS minted from the managed
identity: nothing is copied to read a map, and no account key is involved.
Products are written to local scratch and uploaded when a job finishes,
because a tiled GeoTIFF needs seeks while it is written and blob offers none.
"""

import shutil
import tempfile
import threading
from collections.abc import Iterator
from contextlib import suppress
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import BinaryIO
from urllib.parse import urlparse

from azure.core.credentials import TokenCredential
from azure.core.exceptions import ResourceNotFoundError
from azure.identity import DefaultAzureCredential, ManagedIdentityCredential
from azure.storage.blob import BlobServiceClient, ContainerSasPermissions, generate_container_sas

from src.area_estimation.schemas import JobRecord, MapRecord
from src.area_estimation.workspace import (
    COPY_CHUNK,
    MAP_FILE,
    UploadTooLarge,
    job_key,
    map_key,
    too_large,
)

# Long enough for the longest job a worker is allowed to run, since GDAL keeps
# the SAS it opened a dataset with. Renewed well before it runs out.
SAS_VALID = timedelta(hours=24)
SAS_RENEW_BEFORE = timedelta(hours=2)
UPLOAD_CONCURRENCY = 4


def credential(client_id: str | None) -> TokenCredential:
    """The identity to act as: a user-assigned one by client id, else whatever
    the environment offers (a system identity, or a developer's az login)."""
    if client_id:
        return ManagedIdentityCredential(client_id=client_id)
    return DefaultAzureCredential()


class BlobWorkspace:
    def __init__(self, service: BlobServiceClient, container_name: str, scratch_root: Path | None):
        if not service.account_name:
            raise ValueError("the blob service URL names no storage account")
        self._service = service
        self._account_name: str = service.account_name
        self._container = service.get_container_client(container_name)
        self._container_name = container_name
        self._scratch_root = scratch_root
        self._sas: tuple[str, datetime] | None = None
        self._lock = threading.Lock()

    @classmethod
    def from_url(
        cls, container_url: str, cred: TokenCredential, scratch_root: Path | None = None
    ) -> "BlobWorkspace":
        parsed = urlparse(container_url)
        container_name = parsed.path.strip("/")
        if not container_name or "/" in container_name:
            raise ValueError(f"not a blob container URL: {container_url!r}")
        service = BlobServiceClient(f"{parsed.scheme}://{parsed.netloc}", credential=cred)
        return cls(service, container_name, scratch_root)

    # ------------------------------------------------------------------ records

    def _read(self, key: str) -> str | None:
        try:
            return self._container.download_blob(key).readall().decode()
        except ResourceNotFoundError:
            return None

    def _write(self, key: str, text: str) -> None:
        self._container.upload_blob(key, text.encode(), overwrite=True)

    def read_map(self, campaign_id: int, map_id: str) -> MapRecord | None:
        text = self._read(map_key(campaign_id, map_id, MAP_FILE))
        return MapRecord.model_validate_json(text) if text is not None else None

    def write_map(self, record: MapRecord) -> None:
        self._write(map_key(record.campaign_id, record.id, MAP_FILE), record.model_dump_json())

    def list_maps(self, campaign_id: int) -> Iterator[MapRecord]:
        prefix = f"campaign-{campaign_id}/maps/"
        for blob in self._container.list_blobs(name_starts_with=prefix):
            if blob.name.endswith(f"/{MAP_FILE}"):
                text = self._read(blob.name)
                if text is not None:
                    yield MapRecord.model_validate_json(text)

    def delete_map(self, campaign_id: int, map_id: str) -> None:
        prefix = map_key(campaign_id, map_id) + "/"
        for blob in list(self._container.list_blobs(name_starts_with=prefix)):
            self._container.delete_blob(blob.name)

    def read_job(self, campaign_id: int, job_id: str) -> JobRecord | None:
        text = self._read(job_key(campaign_id, job_id))
        return JobRecord.model_validate_json(text) if text is not None else None

    def write_job(self, job: JobRecord) -> None:
        self._write(job_key(job.campaign_id, job.id), job.model_dump_json())

    # -------------------------------------------------------------------- files

    def put_file(
        self, campaign_id: int, map_id: str, name: str, stream: BinaryIO, max_bytes: int
    ) -> int:
        key = map_key(campaign_id, map_id, name)
        # The limit is applied while streaming so an oversized upload stops at the
        # limit rather than after the whole thing went up.
        counted = _BoundedReader(stream, max_bytes)
        try:
            self._container.upload_blob(
                key, counted, overwrite=True, max_concurrency=UPLOAD_CONCURRENCY
            )
        except UploadTooLarge:
            self.delete_file(campaign_id, map_id, name)
            raise
        return counted.read_bytes

    def read_text(self, campaign_id: int, map_id: str, name: str) -> str | None:
        return self._read(map_key(campaign_id, map_id, name))

    def delete_file(self, campaign_id: int, map_id: str, name: str) -> None:
        with suppress(ResourceNotFoundError):
            self._container.delete_blob(map_key(campaign_id, map_id, name))

    def location(self, campaign_id: int, map_id: str, name: str) -> str:
        return f"/vsiaz/{self._container_name}/{map_key(campaign_id, map_id, name)}"

    def gdal_options(self) -> dict[str, str]:
        return {
            "AZURE_STORAGE_ACCOUNT": self._account_name,
            "AZURE_STORAGE_SAS_TOKEN": self._sas_token(),
        }

    def scratch_dir(self, campaign_id: int, map_id: str) -> Path:
        return Path(tempfile.mkdtemp(prefix=f"ae-{map_id}-", dir=self._scratch_root))

    def store_product(self, campaign_id: int, map_id: str, name: str, path: Path) -> None:
        with path.open("rb") as data:
            self._container.upload_blob(
                map_key(campaign_id, map_id, name),
                data,
                overwrite=True,
                max_concurrency=UPLOAD_CONCURRENCY,
            )
        shutil.rmtree(path.parent, ignore_errors=True)

    # --------------------------------------------------------------------- auth

    def _sas_token(self) -> str:
        with self._lock:
            now = datetime.now(UTC)
            if self._sas is None or self._sas[1] - now < SAS_RENEW_BEFORE:
                self._sas = self._mint_sas(now)
            return self._sas[0]

    def _mint_sas(self, now: datetime) -> tuple[str, datetime]:
        expiry = now + SAS_VALID
        key = self._service.get_user_delegation_key(now - timedelta(minutes=5), expiry)
        token = generate_container_sas(
            self._account_name,
            self._container_name,
            user_delegation_key=key,
            permission=ContainerSasPermissions(read=True, list=True),
            expiry=expiry,
        )
        return token, expiry


class _BoundedReader:
    """The upload as chunks the SDK iterates, refusing to hand out more than the limit."""

    def __init__(self, stream: BinaryIO, max_bytes: int):
        self._stream = stream
        self._max_bytes = max_bytes
        self.read_bytes = 0

    def __iter__(self) -> Iterator[bytes]:
        while chunk := self._stream.read(COPY_CHUNK):
            self.read_bytes += len(chunk)
            if self.read_bytes > self._max_bytes:
                raise too_large(self._max_bytes)
            yield chunk
