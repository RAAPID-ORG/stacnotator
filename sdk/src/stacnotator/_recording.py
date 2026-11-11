import asyncio
import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from stacnotator._credentials import credentials_path


class Recording:
    def __init__(self) -> None:
        self.lock = asyncio.Lock()
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        self.path = (
            credentials_path().parent / "recordings" / f"{stamp}-{uuid.uuid4().hex[:8]}.jsonl"
        )

    def append(self, event: dict[str, Any]) -> dict[str, Any]:
        record = {"version": 1, "time": datetime.now(timezone.utc).isoformat(), **event}
        self.path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        with self.path.open("a", encoding="utf-8") as file:
            self.path.chmod(0o600)
            file.write(json.dumps(record, allow_nan=False) + "\n")
        return record

    def read(self) -> list[dict[str, Any]]:
        return read_recording(self.path) if self.path.exists() else []


def read_recording(path: Path) -> list[dict[str, Any]]:
    events = []
    with path.open(encoding="utf-8") as file:
        for line_number, line in enumerate(file, 1):
            try:
                record = json.loads(line)
                if (
                    not isinstance(record, dict)
                    or record.get("version") != 1
                    or not isinstance(record.get("agent"), dict)
                    or not isinstance(record.get("task"), dict)
                    or not isinstance(record.get("action"), str)
                    or not isinstance(record.get("images", []), list)
                ):
                    raise ValueError("not a STACNotator recording event")
            except ValueError as exc:
                raise ValueError(f"{path}, line {line_number}: {exc}") from exc
            events.append(record)
    return events
