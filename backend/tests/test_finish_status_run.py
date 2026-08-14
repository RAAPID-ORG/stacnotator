"""DB-bound test for background.finish_status_run.

Runs against the real dev Postgres (SessionLocal / settings.DATABASE_URL). Each
test creates its own throwaway campaign and never commits, so the session's
transaction is rolled back at teardown and nothing persists.

There is no repo-wide DB-bound test fixture yet; this file's own connectivity
guard is the skip mechanism, since a sandbox that doesn't export real DB
credentials (tests/conftest.py's setdefault falls back to placeholder
testuser/testdb creds) cannot reach Postgres and must skip rather than fail.
"""

import pytest
from sqlalchemy import text
from sqlalchemy.exc import OperationalError

from src.annotation.embeddings_service import EMBEDDING_RUN
from src.background import finish_status_run
from src.campaigns.models import Campaign
from src.database import SessionLocal
from src.imagery.registration import REGISTRATION_RUN
from src.organizations.models import Organization
from src.projects.models import Project


@pytest.fixture()
def db_session():
    session = SessionLocal()
    try:
        session.execute(text("SELECT 1"))
    except OperationalError:
        session.close()
        pytest.skip(
            "Real Postgres is not reachable with the configured DB credentials "
            "in this environment (see DBUSER/DBPASS/DBHOST) - run this test "
            "where they point at an actual database, e.g. inside "
            "`make dev-shell-backend` or CI."
        )
    try:
        yield session
    finally:
        session.rollback()
        session.close()


def _make_campaign(db_session) -> Campaign:
    org = Organization(name="finish-registration-test-org")
    db_session.add(org)
    db_session.flush()
    project = Project(name="finish-registration-test-project", organization_id=org.id)
    db_session.add(project)
    db_session.flush()
    campaign = Campaign(
        name="finish-registration-test",
        mode="open",
        registration_status="registering",
        embedding_status="registering",
        project_id=project.id,
    )
    db_session.add(campaign)
    db_session.flush()
    return campaign


class TestFinishRegistration:
    def test_two_sequential_calls_append_both_error_lists_without_losing_either(self, db_session):
        """Simulates the mosaic thread and the embeddings thread finishing one
        after another: both sets of errors must survive, on their own status
        fields, with no data lost to the second write."""
        campaign = _make_campaign(db_session)

        finish_status_run(
            db_session,
            campaign.id,
            field=REGISTRATION_RUN,
            status="failed",
            errors=[{"error": "mosaic slice A failed"}],
        )
        finish_status_run(
            db_session,
            campaign.id,
            field=EMBEDDING_RUN,
            status="failed",
            errors=[{"error": "Embeddings: GEE exploded"}],
        )

        db_session.expire_all()
        refreshed = db_session.get(Campaign, campaign.id)
        assert refreshed.registration_status == "failed"
        assert refreshed.embedding_status == "failed"
        assert refreshed.registration_errors == [
            {"error": "mosaic slice A failed"},
            {"error": "Embeddings: GEE exploded"},
        ]

    def test_success_flip_with_no_errors_leaves_errors_list_untouched(self, db_session):
        campaign = _make_campaign(db_session)
        finish_status_run(
            db_session,
            campaign.id,
            field=REGISTRATION_RUN,
            status="ready",
            errors=[],
        )

        db_session.expire_all()
        refreshed = db_session.get(Campaign, campaign.id)
        assert refreshed.registration_status == "ready"
        assert refreshed.registration_errors == []

    def test_clearing_errors_then_finishing_does_not_leave_a_null_entry(self, db_session):
        """The imagery router clears registration_errors at a cycle boundary. If
        that clear lands as the JSON scalar 'null' instead of SQL NULL, the
        append below turns it into [null] and every later read of the campaign
        fails validation."""
        campaign = _make_campaign(db_session)
        campaign.registration_errors = None
        finish_status_run(
            db_session,
            campaign.id,
            field=REGISTRATION_RUN,
            status="ready",
            errors=[],
        )

        db_session.expire_all()
        refreshed = db_session.get(Campaign, campaign.id)
        assert refreshed.registration_errors in (None, [])

    def test_missing_campaign_is_a_noop(self, db_session):
        """No row matches -> the UPDATE affects zero rows; must not raise."""
        finish_status_run(
            db_session,
            campaign_id=-1,
            field=REGISTRATION_RUN,
            status="failed",
            errors=[{"error": "irrelevant"}],
        )
