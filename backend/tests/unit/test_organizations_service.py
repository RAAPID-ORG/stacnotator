"""DB-free tests for the pure pieces of the organizations service."""

from src.organizations.service import normalize_emails


def test_normalize_emails_lowercases_trims_dedupes_in_order():
    assert normalize_emails(["  Alice@Example.COM ", "bob@x.org", "alice@example.com", ""]) == [
        "alice@example.com",
        "bob@x.org",
    ]


def test_normalize_emails_empty_input():
    assert normalize_emails([]) == []
