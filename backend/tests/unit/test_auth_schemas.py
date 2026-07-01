"""Unit tests for auth Pydantic schemas."""

from uuid import uuid4

from src.auth.schemas import UserOut


def test_user_out_display_name_none_accepted():
    u = UserOut(id=uuid4(), email="a@b.com", display_name=None)
    assert u.display_name is None


def test_user_out_display_name_str_accepted():
    u = UserOut(id=uuid4(), email="a@b.com", display_name="Alice")
    assert u.display_name == "Alice"
