import json
import os
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any


@dataclass
class Credentials:
    url: str
    auth: dict[str, Any]
    # Where /api lives. In split deployments (static frontend + separate API host)
    # this differs from the app url the user logged in with.
    api_url: str | None = None


def credentials_path() -> Path:
    config_dir = os.environ.get("STACNOTATOR_CONFIG_DIR")
    base = Path(config_dir) if config_dir else Path.home() / ".config" / "stacnotator"
    return base / "credentials.json"


def save(creds: Credentials) -> None:
    path = credentials_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(asdict(creds), indent=2))
    path.chmod(0o600)


def load() -> Credentials | None:
    path = credentials_path()
    if not path.exists():
        return None
    data = json.loads(path.read_text())
    return Credentials(url=data["url"], auth=data["auth"], api_url=data.get("api_url"))


def clear() -> None:
    credentials_path().unlink(missing_ok=True)
