from __future__ import annotations

import hashlib
import hmac
import shutil
import time
from pathlib import Path

from src.config import get_settings
from src.storage.base import StorageBackend

OP_WRITE = "w"
OP_READ = "r"


class LocalFsStorage(StorageBackend):
    name = "local"

    def __init__(self) -> None:
        settings = get_settings()
        self._root = Path(settings.STORAGE_LOCAL_ROOT).resolve()
        self._root.mkdir(parents=True, exist_ok=True)
        self._secret = settings.TILER_TOKEN_SECRET
        self._internal_base = settings.STORAGE_LOCAL_INTERNAL_BASE.rstrip("/")

    def generate_upload_url(self, path: str, ttl_minutes: int = 30) -> str:
        token = self._sign(path, OP_WRITE, ttl_minutes)
        # Relative; the browser-side uploader prefixes with VITE_API_BASE_URL.
        return f"/api/local-blob/{token}/{path}"

    def generate_read_url(self, path: str, ttl_minutes: int = 60) -> str:
        token = self._sign(path, OP_READ, ttl_minutes)
        return f"{self._internal_base}/api/local-blob/{token}/{path}"

    def exists(self, path: str) -> bool:
        return self.full_path(path).exists()

    def delete(self, path: str) -> None:
        full = self.full_path(path)
        if not full.exists():
            return
        full.unlink()
        parent = full.parent
        while parent != self._root and parent.exists() and not any(parent.iterdir()):
            parent.rmdir()
            parent = parent.parent

    def download_to(self, path: str, local_path):
        dst = Path(local_path)
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(self.full_path(path), dst)

    def upload_from(self, local_path, path: str) -> None:
        full = self.full_path(path)
        full.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(local_path, full)

    def full_path(self, path: str) -> Path:
        full = (self._root / path).resolve()
        if not str(full).startswith(str(self._root)):
            raise ValueError(f"Invalid storage path: {path}")
        return full

    def verify_token(self, token: str, path: str, expected_op: str) -> None:
        try:
            op, expiry_str, _sig = token.split(".")
        except ValueError as e:
            raise ValueError("Invalid token") from e
        if op != expected_op:
            raise ValueError("Token operation mismatch")
        try:
            expiry = int(expiry_str)
        except ValueError as e:
            raise ValueError("Invalid token") from e
        if time.time() > expiry:
            raise ValueError("Token expired")
        expected = self._token(path, op, expiry)
        if not hmac.compare_digest(token, expected):
            raise ValueError("Invalid token")

    def _sign(self, path: str, op: str, ttl_minutes: int) -> str:
        expiry = int(time.time()) + ttl_minutes * 60
        return self._token(path, op, expiry)

    def _token(self, path: str, op: str, expiry: int) -> str:
        payload = f"{op}:{expiry}:{path}"
        sig = hmac.new(self._secret.encode(), payload.encode(), hashlib.sha256).hexdigest()
        return f"{op}.{expiry}.{sig}"
