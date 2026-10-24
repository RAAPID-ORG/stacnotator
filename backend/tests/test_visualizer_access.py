"""Who may open a visualizer, and what its tile session covers.

Mock style, like test_project_dependencies: the rule is what is under test, not
the queries around it.
"""

from unittest.mock import MagicMock
from uuid import uuid4

import pytest
from fastapi import HTTPException

from src.custom_layers.models import CustomMap
from src.imagery.models import ImagerySource
from src.visualizers import service
from src.visualizers.router import _require_viewer


def _db(membership=None, org_membership=None):
    db = MagicMock()
    db.get.return_value = membership
    db.scalars.return_value.first.return_value = org_membership
    return db


def _user(is_admin=False):
    return MagicMock(id=uuid4(), is_platform_admin=is_admin)


def _visualizer(*, is_public, visibility="private"):
    return MagicMock(
        id=3,
        is_public=is_public,
        project=MagicMock(id=7, visibility=visibility, organization_id=5),
        project_id=7,
    )


@pytest.fixture(autouse=True)
def _stub_load(monkeypatch):
    """`_require_viewer` loads by slug; the tests hand it the row directly."""
    holder = {}

    def load(db, *, visualizer_id=None, slug=None):
        return holder["visualizer"]

    monkeypatch.setattr(service, "load", load)
    return holder


def test_published_visualizer_opens_for_a_visitor_with_no_account(_stub_load):
    _stub_load["visualizer"] = _visualizer(is_public=True)
    viewer = _require_viewer(slug="abc", db=_db(), user=None)
    assert viewer.visualizer is _stub_load["visualizer"]
    assert viewer.can_edit is False


def test_feedback_takes_an_account_even_where_reading_does_not(_stub_load):
    _stub_load["visualizer"] = _visualizer(is_public=True)
    anonymous = _require_viewer(slug="abc", db=_db(), user=None)
    assert anonymous.can_give_feedback is False

    signed_in = _require_viewer(slug="abc", db=_db(), user=_user())
    assert signed_in.can_give_feedback is True


def test_unpublished_visualizer_is_not_served_to_a_visitor(_stub_load):
    _stub_load["visualizer"] = _visualizer(is_public=False)
    with pytest.raises(HTTPException) as exc:
        _require_viewer(slug="abc", db=_db(), user=None)
    assert exc.value.status_code == 404


def test_unpublished_visualizer_previews_for_a_project_member(_stub_load):
    _stub_load["visualizer"] = _visualizer(is_public=False)
    db = _db(membership=MagicMock(is_admin=False))
    assert _require_viewer(slug="abc", db=db, user=_user()).can_edit is False


def test_unpublished_visualizer_is_hidden_from_an_outsider(_stub_load):
    _stub_load["visualizer"] = _visualizer(is_public=False)
    with pytest.raises(HTTPException) as exc:
        _require_viewer(slug="abc", db=_db(), user=_user())
    assert exc.value.status_code == 404


def test_project_admin_may_edit(_stub_load):
    _stub_load["visualizer"] = _visualizer(is_public=True)
    db = _db(membership=MagicMock(is_admin=True))
    assert _require_viewer(slug="abc", db=db, user=_user()).can_edit is True


def test_tile_session_grants_the_linked_layers_and_not_their_campaigns():
    visualizer = MagicMock(
        imagery=[MagicMock(source=ImagerySource(id=5, campaign_id=42)), MagicMock(source=None)],
        overlays=[
            MagicMock(custom_map=CustomMap(id=9, campaign_id=7)),
            MagicMock(custom_map=None),
        ],
    )
    assert service.linked_tile_layers(visualizer) == ["custom_map:9", "source:5"]
