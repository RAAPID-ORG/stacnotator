"""The tiler's managed-catalog API (``/catalogs``): one pgstac collection per catalog."""

import httpx

from src.config import get_settings
from src.tilers import tokens

_TIMEOUT = 60.0


class CatalogError(Exception):
    """The tiler could not take the request; the message is safe to show."""


class ObjectRejected(CatalogError):
    def __init__(self, code: str, href: str | None, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.href = href


def _base(name: str) -> str:
    tiler = get_settings().TILERS.get(name)
    if tiler is None:
        raise CatalogError(f"Unknown tiler {name!r}")
    return (tiler.internal_url or tiler.url).rstrip("/")


def _headers() -> dict:
    token = tokens.mint("backend", [], scope=["catalogs:write"])
    return {"Authorization": f"Bearer {token}"}


def _fail(response: httpx.Response, what: str) -> None:
    if response.status_code < 400:
        return
    detail = None
    try:
        body = response.json()
        detail = body.get("detail") if isinstance(body, dict) else None
    except ValueError:
        pass
    if response.status_code == 422 and isinstance(detail, dict) and detail.get("code"):
        raise ObjectRejected(
            str(detail["code"]), detail.get("href"), str(detail.get("message", ""))[:300]
        )
    raise CatalogError(f"The tiler could not {what} (HTTP {response.status_code})")


def _call(method, url: str, what: str, **kwargs) -> httpx.Response:
    try:
        response: httpx.Response = method(url, headers=_headers(), **kwargs)
    except httpx.HTTPError as exc:
        raise CatalogError(f"The tiler is unreachable and could not {what}") from exc
    return response


def capabilities(name: str) -> dict:
    url = f"{_base(name)}/catalogs/capabilities"
    response = _call(httpx.get, url, "describe itself", timeout=_TIMEOUT)
    if response.status_code != 200:
        raise CatalogError("The tiler does not offer managed cloud catalogs")
    try:
        body = response.json()
    except ValueError as exc:
        raise CatalogError("The tiler does not offer managed cloud catalogs") from exc
    providers = body.get("providers") if isinstance(body, dict) else None
    if not isinstance(providers, list) or "azure_blob" not in providers:
        raise CatalogError("The tiler cannot read Azure Blob catalogs")
    return dict(body)


def put_batch(name: str, cid: str, body: dict) -> list[dict]:
    url = f"{_base(name)}/catalogs/{cid}/batches"
    response = _call(httpx.post, url, "register a batch", json=body, timeout=300.0)
    _fail(response, "register a batch")
    return list(response.json().get("items", []))


def verify(name: str, cid: str, item_ids: list[str], title: str | None) -> dict:
    body: dict = {"item_ids": item_ids}
    if title is not None:
        body["title"] = title
    url = f"{_base(name)}/catalogs/{cid}/verify"
    response = _call(httpx.post, url, "verify the catalog", json=body, timeout=300.0)
    _fail(response, "verify the catalog")
    summary: dict = response.json()
    return summary


def query(name: str, cid: str, start: str, end: str) -> list[str]:
    url = f"{_base(name)}/catalogs/{cid}/query"
    body = {"start": start, "end": end}
    response = _call(httpx.post, url, "query the catalog", json=body, timeout=_TIMEOUT)
    _fail(response, "query the catalog")
    return list(response.json().get("item_ids", []))


def delete(name: str, cid: str) -> None:
    url = f"{_base(name)}/catalogs/{cid}"
    response = _call(httpx.delete, url, "delete the catalog", timeout=_TIMEOUT)
    if response.status_code != 404:
        _fail(response, "delete the catalog")
