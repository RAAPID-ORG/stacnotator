"""Where a map lives while its sampling design is being worked on.

A directory per campaign on the disk of whichever process does the
processing, holding each map's uploaded tiles, its areas of interest, the
products a job wrote and the record describing them. Nothing here is durable
by design: an uploaded map exists only for as long as the worker holding it,
and a linked map is never copied at all. Records are whole JSON files replaced
atomically, so a reader in another process never sees a half-written one.
"""

import os
import re
import shutil
import uuid
from collections.abc import Iterator
from pathlib import Path
from typing import BinaryIO

from src.area_estimation.schemas import JobRecord, MapRecord

ID_PATTERN = re.compile(r"^[0-9a-f]{32}$")
COPY_CHUNK = 8 * 1024 * 1024

MAP_FILE = "map.json"
AREAS_FILE = "areas.geojson"
REPROJECTED_FILE = "reprojected.tif"
STRATA_FILE = "strata.tif"


class UploadTooLarge(ValueError):
    pass


def new_id() -> str:
    return uuid.uuid4().hex


def is_id(value: str) -> bool:
    return bool(ID_PATTERN.match(value))


def _write_atomic(path: Path, text: str) -> None:
    tmp = path.with_name(f"{path.name}.tmp")
    tmp.write_text(text)
    os.replace(tmp, path)


class Workspace:
    def __init__(self, root: Path):
        self.root = root

    def _campaign_dir(self, campaign_id: int) -> Path:
        return self.root / f"campaign-{campaign_id}"

    def map_dir(self, campaign_id: int, map_id: str) -> Path:
        if not is_id(map_id):
            raise ValueError(f"not a map id: {map_id!r}")
        return self._campaign_dir(campaign_id) / "maps" / map_id

    def create_map_dir(self, campaign_id: int) -> tuple[str, Path]:
        map_id = new_id()
        path = self.map_dir(campaign_id, map_id)
        (path / "sources").mkdir(parents=True)
        return map_id, path

    def read_map(self, campaign_id: int, map_id: str) -> MapRecord | None:
        path = self.map_dir(campaign_id, map_id) / MAP_FILE
        if not path.is_file():
            return None
        return MapRecord.model_validate_json(path.read_text())

    def write_map(self, record: MapRecord) -> None:
        _write_atomic(
            self.map_dir(record.campaign_id, record.id) / MAP_FILE, record.model_dump_json()
        )

    def list_maps(self, campaign_id: int) -> Iterator[MapRecord]:
        maps = self._campaign_dir(campaign_id) / "maps"
        if not maps.is_dir():
            return
        for child in sorted(maps.iterdir()):
            if is_id(child.name) and (child / MAP_FILE).is_file():
                yield MapRecord.model_validate_json((child / MAP_FILE).read_text())

    def delete_map(self, campaign_id: int, map_id: str) -> None:
        shutil.rmtree(self.map_dir(campaign_id, map_id), ignore_errors=True)

    def _job_path(self, campaign_id: int, job_id: str) -> Path:
        if not is_id(job_id):
            raise ValueError(f"not a job id: {job_id!r}")
        return self._campaign_dir(campaign_id) / "jobs" / f"{job_id}.json"

    def read_job(self, campaign_id: int, job_id: str) -> JobRecord | None:
        path = self._job_path(campaign_id, job_id)
        if not path.is_file():
            return None
        return JobRecord.model_validate_json(path.read_text())

    def write_job(self, job: JobRecord) -> None:
        path = self._job_path(job.campaign_id, job.id)
        path.parent.mkdir(parents=True, exist_ok=True)
        _write_atomic(path, job.model_dump_json())

    @staticmethod
    def save_stream(path: Path, stream: BinaryIO, max_bytes: int) -> int:
        """Copy an upload to disk in chunks, never holding more than one in memory.
        A stream over the limit is removed again rather than left half-written."""
        written = 0
        with path.open("wb") as out:
            while chunk := stream.read(COPY_CHUNK):
                written += len(chunk)
                if written > max_bytes:
                    out.close()
                    path.unlink(missing_ok=True)
                    raise UploadTooLarge(
                        f"File exceeds the {max_bytes // (1024 * 1024)} MB upload limit"
                    )
                out.write(chunk)
        return written
