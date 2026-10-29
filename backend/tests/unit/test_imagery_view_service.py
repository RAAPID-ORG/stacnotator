"""DB-free tests for the view logic in imagery/service.py: which sources a view may
name, and its place among the campaign's views."""

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException

from src.imagery.service import _validated_source_ids, reorder_views


def _source(source_id: int, collection_ids: list[int]) -> SimpleNamespace:
    return SimpleNamespace(
        id=source_id, collections=[SimpleNamespace(id=cid) for cid in collection_ids]
    )


class TestValidatedSourceIds:
    def test_dedupes_preserving_first_occurrence_order(self):
        campaign = SimpleNamespace(imagery_sources=[_source(1, []), _source(2, [])])
        assert _validated_source_ids(campaign, [2, 1, 2]) == [2, 1]

    def test_unknown_source_id_raises_400(self):
        campaign = SimpleNamespace(imagery_sources=[_source(1, [])])
        with pytest.raises(HTTPException) as exc:
            _validated_source_ids(campaign, [1, 7])
        assert exc.value.status_code == 400


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
