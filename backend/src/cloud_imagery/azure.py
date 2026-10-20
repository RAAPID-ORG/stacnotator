"""Read-only Azure Blob listing and metadata, through the SSRF guard."""

from dataclasses import dataclass
from urllib.parse import quote, urlencode

import defusedxml.ElementTree as ET

from src import net_guard

MAX_PAGE = 1000
_MAX_BODY = 8 * 1024 * 1024


@dataclass(frozen=True)
class Blob:
    path: str
    etag: str
    size: int


@dataclass(frozen=True)
class BlobPage:
    blobs: list[Blob]
    next_marker: str | None


def _etag(value: str | None) -> str:
    return (value or "").strip().strip('"')


def list_blobs(
    container_url: str, sas: str, *, prefix: str, marker: str | None, max_results: int
) -> BlobPage:
    params = {
        "restype": "container",
        "comp": "list",
        "prefix": prefix,
        "maxresults": str(max(1, min(max_results, MAX_PAGE))),
    }
    if marker:
        params["marker"] = marker
    url = f"{container_url.rstrip('/')}?{urlencode(params)}&{sas}"
    with net_guard.guarded_client(timeout=30.0) as client:
        response = client.get(url)
    response.raise_for_status()
    if len(response.content) > _MAX_BODY:
        raise ValueError("The storage listing was too large")
    root = ET.fromstring(response.content)
    blobs = []
    for node in root.iter("Blob"):
        props = node.find("Properties")
        etag = props.findtext("Etag") if props is not None else None
        size = props.findtext("Content-Length") if props is not None else None
        blobs.append(Blob(path=node.findtext("Name") or "", etag=_etag(etag), size=int(size or 0)))
    return BlobPage(blobs=blobs, next_marker=root.findtext("NextMarker") or None)


def get_blob(container_url: str, sas: str, path: str) -> Blob | None:
    url = f"{container_url.rstrip('/')}/{quote(path)}?{sas}"
    with net_guard.guarded_client(timeout=30.0) as client:
        response = client.head(url)
    if response.status_code == 404:
        return None
    response.raise_for_status()
    return Blob(
        path=path,
        etag=_etag(response.headers.get("etag")),
        size=int(response.headers.get("content-length") or 0),
    )
