"""Where a map lives while its sampling design is being worked on.

A map's uploaded tiles, its areas of interest, the products a job wrote and
the record describing them, plus one record per job, all keyed by campaign
and map. ``Workspace`` is the contract; ``LocalWorkspace`` keeps everything
in a directory on this machine, and ``blob.BlobWorkspace`` keeps it in an
Azure Blob container shared between the backend and a worker.

Nothing here is durable by design: an uploaded map exists only for as long as
its design is being written, and a linked map is never copied at all. Records
are whole documents replaced atomically - a rename here, a single PUT in blob -
so a reader in another process never sees a half-written one.

GDAL reads the files by their ``location``, a path here and a ``/vsiaz/`` URL
in blob, with whatever ``gdal_options`` the workspace needs for that to be
authorised. Products are written to a ``scratch_dir`` first, because a tiled
GeoTIFF needs seeks while it is written, and stored when the job is done.
"""

import os
import re
import shutil
import uuid
from collections.abc import Iterator
from pathlib import Path
from typing import BinaryIO, Protocol

from src.area_estimation.schemas import JobRecord, MapRecord

ID_PATTERN = re.compile(r"^[0-9a-f]{32}$")
COPY_CHUNK = 8 * 1024 * 1024

MAP_FILE = "map.json"
AREAS_FILE = "areas.geojson"
SOURCES_DIR = "sources"
REPROJECTED_FILE = "reprojected.tif"
STRATA_FILE = "strata.tif"


class UploadTooLarge(ValueError):
    pass


def new_id() -> str:
    return uuid.uuid4().hex


def is_id(value: str) -> bool:
    return bool(ID_PATTERN.match(value))


def require_id(value: str) -> str:
    if not is_id(value):
        raise ValueError(f"not an id: {value!r}")
    return value


def map_key(campaign_id: int, map_id: str, name: str = "") -> str:
    """The relative key of a map's file, the same under every workspace."""
    key = f"campaign-{campaign_id}/maps/{require_id(map_id)}"
    return f"{key}/{name}" if name else key


def job_key(campaign_id: int, job_id: str) -> str:
    return f"campaign-{campaign_id}/jobs/{require_id(job_id)}.json"


def too_large(max_bytes: int) -> UploadTooLarge:
    return UploadTooLarge(f"File exceeds the {max_bytes // (1024 * 1024)} MB upload limit")


def copy_bounded(stream: BinaryIO, out: BinaryIO, max_bytes: int) -> int:
    """Copy in chunks, never holding more than one in memory, stopping at the limit."""
    written = 0
    while chunk := stream.read(COPY_CHUNK):
        written += len(chunk)
        if written > max_bytes:
            raise too_large(max_bytes)
        out.write(chunk)
    return written


class Workspace(Protocol):
    def read_map(self, campaign_id: int, map_id: str) -> MapRecord | None: ...
    def write_map(self, record: MapRecord) -> None: ...
    def list_maps(self, campaign_id: int) -> Iterator[MapRecord]: ...
    def delete_map(self, campaign_id: int, map_id: str) -> None: ...
    def read_job(self, campaign_id: int, job_id: str) -> JobRecord | None: ...
    def write_job(self, job: JobRecord) -> None: ...

    def put_file(
        self, campaign_id: int, map_id: str, name: str, stream: BinaryIO, max_bytes: int
    ) -> int:
        """Store an upload under the map. Over the limit, nothing is left behind."""
        ...

    def read_text(self, campaign_id: int, map_id: str, name: str) -> str | None: ...
    def delete_file(self, campaign_id: int, map_id: str, name: str) -> None: ...

    def location(self, campaign_id: int, map_id: str, name: str) -> str:
        """Where GDAL opens the file."""
        ...

    def gdal_options(self) -> dict[str, str]:
        """Configuration GDAL needs to open a location; empty for plain paths."""
        ...

    def scratch_dir(self, campaign_id: int, map_id: str) -> Path:
        """Local disk a job writes its products to before storing them."""
        ...

    def store_product(self, campaign_id: int, map_id: str, name: str, path: Path) -> None:
        """Move a finished product from scratch into the map. ``path`` is consumed."""
        ...


def _write_atomic(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f"{path.name}.tmp")
    tmp.write_text(text)
    os.replace(tmp, path)


class LocalWorkspace:
    def __init__(self, root: Path):
        self.root = root

    def _path(self, key: str) -> Path:
        return self.root / key

    def map_dir(self, campaign_id: int, map_id: str) -> Path:
        return self._path(map_key(campaign_id, map_id))

    def read_map(self, campaign_id: int, map_id: str) -> MapRecord | None:
        path = self._path(map_key(campaign_id, map_id, MAP_FILE))
        if not path.is_file():
            return None
        return MapRecord.model_validate_json(path.read_text())

    def write_map(self, record: MapRecord) -> None:
        _write_atomic(
            self._path(map_key(record.campaign_id, record.id, MAP_FILE)), record.model_dump_json()
        )

    def list_maps(self, campaign_id: int) -> Iterator[MapRecord]:
        maps = self._path(f"campaign-{campaign_id}/maps")
        if not maps.is_dir():
            return
        for child in sorted(maps.iterdir()):
            if is_id(child.name) and (child / MAP_FILE).is_file():
                yield MapRecord.model_validate_json((child / MAP_FILE).read_text())

    def delete_map(self, campaign_id: int, map_id: str) -> None:
        shutil.rmtree(self.map_dir(campaign_id, map_id), ignore_errors=True)

    def read_job(self, campaign_id: int, job_id: str) -> JobRecord | None:
        path = self._path(job_key(campaign_id, job_id))
        if not path.is_file():
            return None
        return JobRecord.model_validate_json(path.read_text())

    def write_job(self, job: JobRecord) -> None:
        _write_atomic(self._path(job_key(job.campaign_id, job.id)), job.model_dump_json())

    def put_file(
        self, campaign_id: int, map_id: str, name: str, stream: BinaryIO, max_bytes: int
    ) -> int:
        path = self._path(map_key(campaign_id, map_id, name))
        path.parent.mkdir(parents=True, exist_ok=True)
        try:
            with path.open("wb") as out:
                return copy_bounded(stream, out, max_bytes)
        except UploadTooLarge:
            path.unlink(missing_ok=True)
            raise

    def read_text(self, campaign_id: int, map_id: str, name: str) -> str | None:
        path = self._path(map_key(campaign_id, map_id, name))
        return path.read_text() if path.is_file() else None

    def delete_file(self, campaign_id: int, map_id: str, name: str) -> None:
        self._path(map_key(campaign_id, map_id, name)).unlink(missing_ok=True)

    def location(self, campaign_id: int, map_id: str, name: str) -> str:
        return str(self._path(map_key(campaign_id, map_id, name)))

    def gdal_options(self) -> dict[str, str]:
        return {}

    def scratch_dir(self, campaign_id: int, map_id: str) -> Path:
        # Products are written straight into the map's directory: storing them
        # is then a rename onto themselves.
        path = self.map_dir(campaign_id, map_id)
        path.mkdir(parents=True, exist_ok=True)
        return path

    def store_product(self, campaign_id: int, map_id: str, name: str, path: Path) -> None:
        target = self._path(map_key(campaign_id, map_id, name))
        if path.resolve() != target.resolve():
            os.replace(path, target)
