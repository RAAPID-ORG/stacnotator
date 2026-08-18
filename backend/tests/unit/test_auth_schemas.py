"""Unit tests for auth Pydantic schemas."""

from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

import pytest

from src.auth.constants import TERMS_VERSION
from src.auth.schemas import MeOut, UserOut


def _user(email="ada.lovelace@example.org", display_name="Ada"):
    return SimpleNamespace(id=uuid4(), email=email, display_name=display_name)


def _own_record(terms_accepted_version=None):
    return SimpleNamespace(
        id=uuid4(),
        email="ada.lovelace@example.org",
        display_name="Ada",
        is_admin=False,
        issuer="firebase",
        external_uid="ext-1",
        terms_accepted_version=terms_accepted_version,
    )


def test_for_viewer_without_email_omits_the_address():
    u = UserOut.for_viewer(_user(), with_email=False)
    assert u.email is None
    assert u.display_name == "Ada"


def test_for_viewer_with_email_keeps_the_address():
    u = UserOut.for_viewer(_user(), with_email=True)
    assert u.email == "ada.lovelace@example.org"


def test_missing_display_name_falls_back_to_the_email_local_part():
    u = UserOut.for_viewer(_user(display_name=None), with_email=False)
    assert u.display_name == "ada.lovelace"
    assert u.email is None


def test_own_record_carries_the_version_in_force_alongside_the_accepted_one():
    me = MeOut.model_validate(_own_record())
    assert me.terms_version == TERMS_VERSION
    assert me.terms_accepted_version is None


def test_own_record_reports_an_acceptance_of_the_current_terms():
    me = MeOut.model_validate(_own_record(terms_accepted_version=TERMS_VERSION))
    assert me.terms_accepted_version == me.terms_version


def test_the_version_we_record_is_the_one_the_document_shows():
    """What we store has to name the text the user actually read."""
    terms = Path(__file__).parents[3] / "frontend/src/features/legal/terms.md"
    if not terms.exists():
        pytest.skip("frontend sources not available")

    assert f"Version {TERMS_VERSION}" in terms.read_text()
