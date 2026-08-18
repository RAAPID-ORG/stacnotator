"""DB-free tests for the pure pieces of the organizations service."""

from src.organizations.service import normalize_emails


def test_normalize_emails_lowercases_trims_dedupes_in_order():
    assert normalize_emails(["  Alice@Example.COM ", "bob@x.org", "alice@example.com", ""]) == [
        "alice@example.com",
        "bob@x.org",
    ]


def test_normalize_emails_empty_input():
    assert normalize_emails([]) == []


def test_membership_standing_maps_row_status_to_the_viewer_s_standing():
    from src.organizations.models import MEMBER_STATUS_ACTIVE, MEMBER_STATUS_PENDING
    from src.organizations.service import membership_standing

    assert membership_standing(MEMBER_STATUS_ACTIVE) == "active"
    assert membership_standing(MEMBER_STATUS_PENDING) == "pending"
    assert membership_standing(None) == "none"


def test_access_request_block_allows_a_first_request_and_a_repeat():
    from src.organizations.models import MEMBER_STATUS_PENDING, ORG_STATUS_APPROVED
    from src.organizations.service import access_request_block

    assert access_request_block(ORG_STATUS_APPROVED, None) is None
    # Asking again is how a requester amends their note.
    assert access_request_block(ORG_STATUS_APPROVED, MEMBER_STATUS_PENDING) is None


def test_access_request_block_refuses_members_and_unapproved_orgs():
    from src.organizations.models import (
        MEMBER_STATUS_ACTIVE,
        ORG_STATUS_APPROVED,
        ORG_STATUS_PENDING,
        ORG_STATUS_REJECTED,
    )
    from src.organizations.service import access_request_block

    assert access_request_block(ORG_STATUS_APPROVED, MEMBER_STATUS_ACTIVE) is not None
    assert access_request_block(ORG_STATUS_PENDING, None) is not None
    assert access_request_block(ORG_STATUS_REJECTED, None) is not None
