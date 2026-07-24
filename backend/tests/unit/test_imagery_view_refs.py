"""DB-free characterization tests for `_resolve_view_refs`.

`_resolve_view_refs` is the single resolver that turns frontend view
collection_refs into DB id pairs. It accepts three ref encodings and drops
anything that does not resolve:

- real numeric-string ids present in the id maps (existing entities),
- composite positional keys ``"<src_idx>:<col_idx>"`` (newly created entities
  in the reconcile flow),
- bare positional indices ``"<col_idx>"`` for the collection (campaign-create
  flow, resolved via the positional fallback).
"""

from src.imagery.schemas import (
    ImageryCollectionCreate,
    ImagerySliceCreate,
    ImagerySourceCreate,
    ViewCollectionRefCreate,
)
from src.imagery.service import _resolve_view_refs


def _source(name: str, collection_names: list[str]) -> ImagerySourceCreate:
    return ImagerySourceCreate(
        name=name,
        visualizations=[],
        collections=[
            ImageryCollectionCreate(
                name=col_name,
                slices=[ImagerySliceCreate(start_date="2020-01-01", end_date="2020-01-31")],
            )
            for col_name in collection_names
        ],
    )


def _ref(
    source_id: str, collection_id: str, show_as_window: bool = True
) -> ViewCollectionRefCreate:
    return ViewCollectionRefCreate(
        source_id=source_id, collection_id=collection_id, show_as_window=show_as_window
    )


def test_resolves_real_numeric_ids():
    source_id_map = {"10": 10}
    collection_id_map = {"100": 100}
    result = _resolve_view_refs(
        [_ref("10", "100")], source_id_map, collection_id_map, [_source("A", ["c"])]
    )
    assert result == [{"collection_id": 100, "source_id": 10, "show_as_window": True}]


def test_resolves_composite_positional_key():
    source_id_map = {"0": 10}
    collection_id_map = {"0:0": 100}
    result = _resolve_view_refs(
        [_ref("0", "0:0")], source_id_map, collection_id_map, [_source("A", ["c"])]
    )
    assert result == [{"collection_id": 100, "source_id": 10, "show_as_window": True}]


def test_resolves_bare_index_via_positional_fallback():
    """Campaign-create refs carry a bare collection index (``"0"``), not the
    composite key; the positional fallback maps it onto ``"<src>:<col>"``."""
    source_id_map = {"0": 10}
    collection_id_map = {"0:0": 100}
    result = _resolve_view_refs(
        [_ref("0", "0")], source_id_map, collection_id_map, [_source("A", ["c"])]
    )
    assert result == [{"collection_id": 100, "source_id": 10, "show_as_window": True}]


def test_resolves_bare_index_for_second_collection():
    source_id_map = {"0": 10}
    collection_id_map = {"0:0": 100, "0:1": 101}
    result = _resolve_view_refs(
        [_ref("0", "1")], source_id_map, collection_id_map, [_source("A", ["c0", "c1"])]
    )
    assert result == [{"collection_id": 101, "source_id": 10, "show_as_window": True}]


def test_preserves_show_as_window_false():
    source_id_map = {"0": 10}
    collection_id_map = {"0:0": 100}
    result = _resolve_view_refs(
        [_ref("0", "0", show_as_window=False)],
        source_id_map,
        collection_id_map,
        [_source("A", ["c"])],
    )
    assert result == [{"collection_id": 100, "source_id": 10, "show_as_window": False}]


def test_drops_unknown_source_ref():
    source_id_map = {"0": 10}
    collection_id_map = {"0:0": 100}
    result = _resolve_view_refs(
        [_ref("99", "0")], source_id_map, collection_id_map, [_source("A", ["c"])]
    )
    assert result == []


def test_drops_ref_with_resolvable_source_but_unknown_collection():
    source_id_map = {"0": 10}
    collection_id_map = {"0:0": 100}
    result = _resolve_view_refs(
        [_ref("0", "5")], source_id_map, collection_id_map, [_source("A", ["c"])]
    )
    assert result == []


def test_does_not_resolve_by_name():
    """The resolver is index/id-based only; a name-valued ref does not resolve."""
    source_id_map = {"0": 10}
    collection_id_map = {"0:0": 100}
    result = _resolve_view_refs(
        [_ref("A", "c")], source_id_map, collection_id_map, [_source("A", ["c"])]
    )
    assert result == []


def test_keeps_resolvable_and_drops_stale_in_mixed_batch():
    source_id_map = {"0": 10}
    collection_id_map = {"0:0": 100}
    result = _resolve_view_refs(
        [_ref("0", "0"), _ref("99", "99")],
        source_id_map,
        collection_id_map,
        [_source("A", ["c"])],
    )
    assert result == [{"collection_id": 100, "source_id": 10, "show_as_window": True}]


def test_empty_refs_returns_empty():
    assert _resolve_view_refs([], {}, {}, []) == []
