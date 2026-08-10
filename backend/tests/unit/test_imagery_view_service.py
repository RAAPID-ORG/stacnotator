"""DB-free tests for the view membership logic in imagery/service.py.

A view stores an ordered list of source ids; whether a collection is a
window lives solely in the view's canvas layouts. These tests pin the
eligible-set derivation, the source-id validation, and the layout-sync
arguments on membership changes.
"""

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException

from src.imagery import service
from src.imagery.schemas import ImageryViewUpdate
from src.imagery.service import _eligible_collection_ids, _validated_source_ids, reorder_views


def _source(source_id: int, collection_ids: list[int]) -> SimpleNamespace:
    return SimpleNamespace(
        id=source_id, collections=[SimpleNamespace(id=cid) for cid in collection_ids]
    )


class TestEligibleCollectionIds:
    def test_union_of_all_collections_of_the_views_sources(self):
        sources = [_source(1, [10, 11]), _source(2, [20]), _source(3, [30])]
        assert _eligible_collection_ids(sources, [1, 3]) == {10, 11, 30}

    def test_stale_source_ids_are_ignored(self):
        assert _eligible_collection_ids([_source(1, [10])], [1, 99]) == {10}

    def test_empty_membership_is_empty(self):
        assert _eligible_collection_ids([_source(1, [10])], []) == set()


class TestValidatedSourceIds:
    def test_dedupes_preserving_first_occurrence_order(self):
        campaign = SimpleNamespace(imagery_sources=[_source(1, []), _source(2, [])])
        assert _validated_source_ids(campaign, [2, 1, 2]) == [2, 1]

    def test_unknown_source_id_raises_400(self):
        campaign = SimpleNamespace(imagery_sources=[_source(1, [])])
        with pytest.raises(HTTPException) as exc:
            _validated_source_ids(campaign, [1, 7])
        assert exc.value.status_code == 400


class TestUpdateViewSync:
    def test_membership_change_syncs_only_newly_eligible_as_added(self, monkeypatch):
        """Dropping source 2 and adding source 3 must keep={10,30} and
        add=[30] - existing windows are never re-placed, removed ones are
        dropped in sync_view_layouts via the keep set."""
        campaign = SimpleNamespace(
            id=5, imagery_sources=[_source(1, [10]), _source(2, [20]), _source(3, [30])]
        )
        view = SimpleNamespace(id=8, campaign_id=5, name="A", source_ids=[1, 2])
        monkeypatch.setattr(service, "_campaign_view", lambda db, c, vid: view)
        sync = MagicMock()
        monkeypatch.setattr(service, "sync_view_layouts", sync)
        monkeypatch.setattr(service, "flag_modified", MagicMock())

        service.update_view(MagicMock(), campaign, 8, ImageryViewUpdate(source_ids=[1, 3]))

        assert view.source_ids == [1, 3]
        sync.assert_called_once()
        kwargs = sync.call_args.kwargs
        assert kwargs["window_collection_ids"] == {10, 30}
        assert kwargs["added_collection_ids"] == [30]

    def test_pure_rename_never_touches_layouts(self, monkeypatch):
        view = SimpleNamespace(id=8, campaign_id=5, name="A", source_ids=[1])
        monkeypatch.setattr(service, "_campaign_view", lambda db, c, vid: view)
        sync = MagicMock()
        monkeypatch.setattr(service, "sync_view_layouts", sync)

        service.update_view(
            MagicMock(),
            SimpleNamespace(id=5, imagery_sources=[_source(1, [10])]),
            8,
            ImageryViewUpdate(name="B"),
        )

        assert view.name == "B"
        sync.assert_not_called()


class TestReorderViews:
    def test_rewrites_display_order_by_list_position(self):
        views = [SimpleNamespace(id=1, display_order=0), SimpleNamespace(id=2, display_order=1)]
        campaign = SimpleNamespace(imagery_views=views)

        reorder_views(MagicMock(), campaign, [2, 1])

        assert (views[0].display_order, views[1].display_order) == (1, 0)

    def test_partial_or_foreign_id_list_raises_400(self):
        campaign = SimpleNamespace(imagery_views=[SimpleNamespace(id=1), SimpleNamespace(id=2)])
        for ids in ([1], [1, 2, 3], [1, 1]):
            with pytest.raises(HTTPException) as exc:
                reorder_views(MagicMock(), campaign, ids)
            assert exc.value.status_code == 400
