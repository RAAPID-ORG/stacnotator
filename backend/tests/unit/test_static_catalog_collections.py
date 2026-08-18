"""Static catalogs (an S3-hosted catalog.json, e.g. Vantor OpenData) have no /collections
endpoint - their collections hang off the root as `child` links."""

from src.stac_browser import client as client_mod


class _Link:
    def __init__(self, href: str):
        self._href = href

    def get_absolute_href(self) -> str:
        return self._href


class _Client:
    """Just enough of a pystac_client.Client for the child-link walk."""

    def __init__(self, child_hrefs: list[str]):
        self._child_hrefs = child_hrefs

    def get_links(self, rel: str):
        return [_Link(h) for h in self._child_hrefs] if rel == "child" else []


class _StacIO:
    def __init__(self, docs: dict[str, dict]):
        self._docs = docs

    def read_json(self, href: str) -> dict:
        if href not in self._docs:
            raise OSError(f"404 {href}")
        return self._docs[href]


def _collection_doc(cid: str) -> dict:
    return {"type": "Collection", "id": cid, "stac_version": "1.0.0"}


def test_child_links_are_read_as_collections():
    docs = {"a.json": _collection_doc("event-a"), "b.json": _collection_doc("event-b")}
    out = client_mod._child_collections(_Client(list(docs)), _StacIO(docs))
    assert [c["id"] for c in out] == ["event-a", "event-b"]


def test_unreachable_child_does_not_abort_the_listing():
    docs = {"b.json": _collection_doc("event-b")}
    out = client_mod._child_collections(_Client(["a.json", "b.json"]), _StacIO(docs))
    assert [c["id"] for c in out] == ["event-b"]


def test_child_catalog_is_surfaced_as_unavailable(monkeypatch):
    monkeypatch.setattr(client_mod, "get_client", lambda url, sign=True: None)
    monkeypatch.setattr(
        client_mod,
        "_raw_collections",
        lambda client: [{"type": "Catalog", "id": "events", "title": "Events"}],
    )
    out = client_mod.list_collections("https://example.org/catalog.json")
    assert len(out) == 1
    assert out[0]["id"] == "events"
    assert out[0]["selectable"] is False
    assert out[0]["unavailable_reason"] == client_mod.NESTED_CATALOG_REASON
