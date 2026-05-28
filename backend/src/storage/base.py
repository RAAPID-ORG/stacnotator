"""Storage backend interface.

Concrete implementations live alongside (`azure.py`, `local.py`) and are
chosen by `get_backend()` based on the STORAGE_BACKEND setting. Pattern
mirrors `src/auth/providers/`.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from pathlib import Path


class StorageBackend(ABC):
    """Blob-storage primitives needed by the custom map pipeline.

    Two URL flavors:
      - upload_url   write-scoped, short TTL, used by the browser for
                     direct-to-blob PUTs.
      - read_url     read-scoped, served to the tiler (and to ourselves
                     when downloading the source for preprocessing).

    Streaming I/O (`download_to`, `upload_from`) keeps the worker's memory
    bounded regardless of file size.
    """

    name: str

    @abstractmethod
    def generate_upload_url(self, path: str, ttl_minutes: int = 30) -> str:
        """Short-lived URL the browser PUTs raw bytes to."""

    @abstractmethod
    def generate_read_url(self, path: str, ttl_minutes: int = 60) -> str:
        """URL the tiler / worker fetches the blob from."""

    @abstractmethod
    def exists(self, path: str) -> bool:
        """True if a blob currently lives at `path`."""

    @abstractmethod
    def delete(self, path: str) -> None:
        """Best-effort delete. Should not raise on missing blob."""

    @abstractmethod
    def download_to(self, path: str, local_path: str | Path) -> None:
        """Stream the blob to a local file. Caller owns the destination."""

    @abstractmethod
    def upload_from(self, local_path: str | Path, path: str) -> None:
        """Stream a local file to the blob at `path`, overwriting if present."""
