"""Tests for task-assignment export/import (campaigns/service.py)."""

from unittest.mock import MagicMock, patch
from uuid import uuid4

import pandas as pd
import pytest
from fastapi import HTTPException

from src.annotation.constants import ANNOTATION_TASK_STATUS_PENDING
from src.annotation.models import AnnotationTaskAssignment
from src.campaigns.assignments import (
    USERS_CSV_COLUMNS,
    _label_id_to_name,
    _split_emails,
    _unique_users,
    build_task_assignments_export,
    import_task_assignments,
)


def _mock_db():
    db = MagicMock()
    db.scalars.return_value.all.return_value = []
    return db


def _stub_scalars(db, results_in_order):
    """Make db.scalars(...).all() return each list in order across calls."""
    calls = {"i": 0}

    def _side_effect(*_args, **_kwargs):
        chain = MagicMock()
        i = calls["i"]
        calls["i"] += 1
        chain.all.return_value = results_in_order[i] if i < len(results_in_order) else []
        return chain

    db.scalars.side_effect = _side_effect


def _user(email):
    return MagicMock(id=uuid4(), email=email)


def _task(number, task_id):
    return MagicMock(id=task_id, annotation_number=number)


def _csv_bytes(records, columns=("annotation_number", "assignees", "reviewers")):
    df = pd.DataFrame(records, columns=list(columns))
    return df.to_csv(index=False).encode()


# ---------------------------------------------------------------------------
# Pure helpers
# ---------------------------------------------------------------------------


class TestSplitEmails:
    def test_empty(self):
        assert _split_emails("") == []
        assert _split_emails(None) == []

    def test_strips_and_drops_blanks(self):
        assert _split_emails(" a@x.com ,b@x.com,, ") == ["a@x.com", "b@x.com"]


class TestUniqueUsers:
    def test_dedups_case_insensitively_preserving_order(self):
        ua, ub = _user("a@x.com"), _user("b@x.com")
        lookup = {"a@x.com": ua, "b@x.com": ub}
        result = _unique_users(["A@x.com", "b@x.com", "a@x.com"], lookup)
        assert result == [ua, ub]


class TestLabelIdToName:
    def test_dict_labels(self):
        campaign = MagicMock()
        campaign.settings.labels = {"1": {"name": "Forest"}, "2": {"name": "Water"}}
        assert _label_id_to_name(campaign) == {1: "Forest", 2: "Water"}

    def test_no_settings(self):
        campaign = MagicMock()
        campaign.settings = None
        assert _label_id_to_name(campaign) == {}


# ---------------------------------------------------------------------------
# Export
# ---------------------------------------------------------------------------


class TestBuildExport:
    def _wire_db(self, db, tasks, assignment_rows, annotation_rows, campaign_users):
        scalars_calls = {"i": 0}

        def scalars_side(*_a, **_k):
            chain = MagicMock()
            i = scalars_calls["i"]
            scalars_calls["i"] += 1
            if i == 0:
                chain.all.return_value = tasks
            else:
                chain.unique.return_value.all.return_value = campaign_users
            return chain

        db.scalars.side_effect = scalars_side

        exec_calls = {"i": 0}

        def exec_side(*_a, **_k):
            chain = MagicMock()
            i = exec_calls["i"]
            exec_calls["i"] += 1
            chain.all.return_value = assignment_rows if i == 0 else annotation_rows
            return chain

        db.execute.side_effect = exec_side

    def test_two_frames_with_pairs_and_users(self):
        db = _mock_db()
        campaign = MagicMock(id=1)
        campaign.settings.labels = {"1": {"name": "Forest"}, "2": {"name": "Water"}}

        cu = MagicMock(is_admin=True, is_authorative_reviewer=False)
        cu.user = MagicMock(email="alice@x.com", display_name="Alice")

        self._wire_db(
            db,
            tasks=[_task(1001, 10), _task(1002, 20)],
            assignment_rows=[(10, "alice@x.com", False), (10, "bob@x.com", True)],
            annotation_rows=[(10, "alice@x.com", 1), (10, "carol@x.com", None)],
            campaign_users=[cu],
        )

        assignments_df, users_df = build_task_assignments_export(db, campaign)

        row = assignments_df[assignments_df.annotation_number == 1001].iloc[0]
        assert row.assignees == "alice@x.com"
        assert row.reviewers == "bob@x.com"
        assert row.annotation_count == 2
        # sorted by email; missing label renders as SKIPPED
        assert row.existing_annotations == "alice@x.com=Forest, carol@x.com=SKIPPED"

        empty = assignments_df[assignments_df.annotation_number == 1002].iloc[0]
        assert empty.assignees == ""
        assert empty.reviewers == ""
        assert empty.annotation_count == 0

        assert list(users_df.columns) == USERS_CSV_COLUMNS
        assert users_df.iloc[0]["email"] == "alice@x.com"
        assert bool(users_df.iloc[0]["is_admin"]) is True
        assert bool(users_df.iloc[0]["is_authoritative_reviewer"]) is False


# ---------------------------------------------------------------------------
# Import - validation
# ---------------------------------------------------------------------------


class TestImportValidation:
    def test_missing_required_column_raises_400(self):
        db = _mock_db()
        contents = _csv_bytes(
            [{"annotation_number": 1001, "assignees": "a@x.com"}],
            columns=("annotation_number", "assignees"),
        )
        with pytest.raises(HTTPException) as exc:
            import_task_assignments(db, 1, contents)
        assert exc.value.status_code == 400
        assert "reviewers" in exc.value.detail

    def test_unknown_email_raises_400(self):
        db = _mock_db()
        _stub_scalars(db, [[_task(1001, 10)], [], []])  # no users found
        contents = _csv_bytes(
            [{"annotation_number": 1001, "assignees": "ghost@x.com", "reviewers": ""}]
        )
        with pytest.raises(HTTPException) as exc:
            import_task_assignments(db, 1, contents)
        assert exc.value.status_code == 400
        assert "not found" in exc.value.detail
        assert "ghost@x.com" in exc.value.detail
        db.commit.assert_not_called()

    def test_non_member_raises_400(self):
        db = _mock_db()
        alice = _user("alice@x.com")
        _stub_scalars(db, [[_task(1001, 10)], [alice], []])  # found but not a member
        contents = _csv_bytes(
            [{"annotation_number": 1001, "assignees": "alice@x.com", "reviewers": ""}]
        )
        with pytest.raises(HTTPException) as exc:
            import_task_assignments(db, 1, contents)
        assert exc.value.status_code == 400
        assert "not a member" in exc.value.detail

    def test_unknown_task_raises_400(self):
        db = _mock_db()
        alice = _user("alice@x.com")
        _stub_scalars(db, [[_task(1001, 10)], [alice], [alice.id]])
        contents = _csv_bytes(
            [{"annotation_number": 9999, "assignees": "alice@x.com", "reviewers": ""}]
        )
        with pytest.raises(HTTPException) as exc:
            import_task_assignments(db, 1, contents)
        assert exc.value.status_code == 400
        assert "not found in campaign" in exc.value.detail

    def test_duplicate_annotation_number_raises_400(self):
        db = _mock_db()
        alice = _user("alice@x.com")
        _stub_scalars(db, [[_task(1001, 10)], [alice], [alice.id]])
        contents = _csv_bytes(
            [
                {"annotation_number": 1001, "assignees": "alice@x.com", "reviewers": ""},
                {"annotation_number": 1001, "assignees": "alice@x.com", "reviewers": ""},
            ]
        )
        with pytest.raises(HTTPException) as exc:
            import_task_assignments(db, 1, contents)
        assert "Duplicate" in exc.value.detail

    def test_same_user_assignee_and_reviewer_raises_400(self):
        db = _mock_db()
        alice = _user("alice@x.com")
        _stub_scalars(db, [[_task(1001, 10)], [alice], [alice.id]])
        contents = _csv_bytes(
            [{"annotation_number": 1001, "assignees": "alice@x.com", "reviewers": "alice@x.com"}]
        )
        with pytest.raises(HTTPException) as exc:
            import_task_assignments(db, 1, contents)
        assert "both assignee and reviewer" in exc.value.detail

    def test_reviewer_without_assignee_raises_400(self):
        db = _mock_db()
        bob = _user("bob@x.com")
        _stub_scalars(db, [[_task(1001, 10)], [bob], [bob.id]])
        contents = _csv_bytes(
            [{"annotation_number": 1001, "assignees": "", "reviewers": "bob@x.com"}]
        )
        with pytest.raises(HTTPException) as exc:
            import_task_assignments(db, 1, contents)
        assert "no assignee" in exc.value.detail


# ---------------------------------------------------------------------------
# Import - apply (replace semantics)
# ---------------------------------------------------------------------------


class TestImportApply:
    def test_replaces_assignments_for_listed_task(self):
        db = _mock_db()
        alice, bob = _user("alice@x.com"), _user("bob@x.com")
        _stub_scalars(db, [[_task(1001, 10)], [alice, bob], [alice.id, bob.id]])
        contents = _csv_bytes(
            [{"annotation_number": 1001, "assignees": "alice@x.com", "reviewers": "bob@x.com"}]
        )

        with patch("src.campaigns.assignments._seed_assignment_status", return_value={}):
            result = import_task_assignments(db, 1, contents)

        # Existing assignments for the task are cleared first.
        assert db.execute.call_count == 1
        added = [c.args[0] for c in db.add.call_args_list]
        assignments = [a for a in added if isinstance(a, AnnotationTaskAssignment)]
        assert {(a.user_id, a.is_review) for a in assignments} == {
            (alice.id, False),
            (bob.id, True),
        }
        assert all(a.task_id == 10 for a in assignments)
        assert all(a.status == ANNOTATION_TASK_STATUS_PENDING for a in assignments)
        db.commit.assert_called_once()
        assert result == {
            "tasks_updated": 1,
            "assignees_created": 1,
            "reviewers_created": 1,
        }

    def test_empty_row_clears_task(self):
        db = _mock_db()
        _stub_scalars(db, [[_task(1001, 10)], [], []])
        contents = _csv_bytes([{"annotation_number": 1001, "assignees": "", "reviewers": ""}])

        with patch("src.campaigns.assignments._seed_assignment_status", return_value={}):
            result = import_task_assignments(db, 1, contents)

        # Task still gets its assignments deleted, but nothing is added.
        assert db.execute.call_count == 1
        added = [c.args[0] for c in db.add.call_args_list]
        assert [a for a in added if isinstance(a, AnnotationTaskAssignment)] == []
        assert result == {
            "tasks_updated": 1,
            "assignees_created": 0,
            "reviewers_created": 0,
        }
