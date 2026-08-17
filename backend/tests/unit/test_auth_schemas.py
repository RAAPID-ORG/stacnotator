"""Unit tests for auth Pydantic schemas."""

from types import SimpleNamespace
from uuid import uuid4

from src.auth.schemas import UserOut


def _user(email="ada.lovelace@example.org", display_name="Ada"):
    return SimpleNamespace(id=uuid4(), email=email, display_name=display_name)


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
