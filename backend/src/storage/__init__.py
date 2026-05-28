from functools import lru_cache

from src.config import get_settings
from src.storage.base import StorageBackend
from src.storage.paths import custom_map_cog_path, custom_map_prefix, custom_map_source_path

__all__ = [
    "StorageBackend",
    "get_backend",
    "custom_map_cog_path",
    "custom_map_prefix",
    "custom_map_source_path",
]


@lru_cache
def get_backend() -> StorageBackend:
    name = get_settings().STORAGE_BACKEND.lower()
    match name:
        case "azure":
            from src.storage.azure import AzureBlobStorage

            return AzureBlobStorage()
        case "local":
            from src.storage.local import LocalFsStorage

            return LocalFsStorage()
        case _:
            raise RuntimeError(f"Unknown STORAGE_BACKEND: {name!r}")
