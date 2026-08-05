"""Tests for organizations service DB-bound logic (organizations/service.py).
Mirrors tests/test_projects_service.py's mock style."""

from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException

from src.organizations.models import Organization
from src.organizations.service import update_organization


def _mock_db():
    return MagicMock()


class TestUpdateOrganization:
    def test_renaming_to_an_existing_name_raises_409(self):
        db = _mock_db()
        org = Organization(id=1, name="Old Name")
        db.get.return_value = org
        db.scalar.return_value = Organization(id=2, name="Taken")

        with pytest.raises(HTTPException) as exc_info:
            update_organization(db, 1, name="Taken", description=None)

        assert exc_info.value.status_code == 409
        assert org.name == "Old Name"

    def test_renaming_to_the_same_name_skips_the_uniqueness_check(self):
        db = _mock_db()
        org = Organization(id=1, name="Same")
        db.get.return_value = org

        update_organization(db, 1, name="Same", description="new desc")

        assert org.description == "new desc"
        db.scalar.assert_not_called()

    def test_renaming_to_an_unused_name_succeeds(self):
        db = _mock_db()
        org = Organization(id=1, name="Old")
        db.get.return_value = org
        db.scalar.return_value = None

        update_organization(db, 1, name="New", description=None)

        assert org.name == "New"
