from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse

from src.storage import get_backend
from src.storage.local import OP_READ, OP_WRITE, LocalFsStorage

router = APIRouter(prefix="/local-blob", tags=["LocalStorage"])


def _local_backend() -> LocalFsStorage:
    backend = get_backend()
    if not isinstance(backend, LocalFsStorage):
        raise HTTPException(status_code=500, detail="Local storage backend not active")
    return backend


@router.put("/{token}/{path:path}")
async def upload(token: str, path: str, request: Request):
    backend = _local_backend()
    try:
        backend.verify_token(token, path, OP_WRITE)
    except ValueError as e:
        raise HTTPException(status_code=401, detail=str(e)) from e

    full = backend.full_path(path)
    full.parent.mkdir(parents=True, exist_ok=True)

    bytes_written = 0
    with open(full, "wb") as f:
        async for chunk in request.stream():
            if not chunk:
                continue
            f.write(chunk)
            bytes_written += len(chunk)
    return {"ok": True, "bytes": bytes_written}


@router.get("/{token}/{path:path}")
def download(token: str, path: str):
    backend = _local_backend()
    try:
        backend.verify_token(token, path, OP_READ)
    except ValueError as e:
        raise HTTPException(status_code=401, detail=str(e)) from e

    full = backend.full_path(path)
    if not full.exists():
        raise HTTPException(status_code=404, detail="Not found")
    return FileResponse(full)
