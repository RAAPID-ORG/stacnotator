"""Tests for annotation service layer."""

from unittest.mock import MagicMock
from uuid import uuid4

import pytest
from fastapi import HTTPException

from src.annotation.constants import (
    ANNOTATION_TASK_STATUS_DONE,
    ANNOTATION_TASK_STATUS_PENDING,
    ANNOTATION_TASK_STATUS_SKIPPED,
)
from src.annotation.models import Annotation, AnnotationGeometry, AnnotationTaskAssignment
from src.annotation.schemas import AnnotationCreate, AnnotationFromTaskCreate, AnnotationUpdate
from src.annotation.service import (
    add_annotation_for_task,
    create_annotation,
    create_annotation_tasks_from_csv,
    delete_annotation,
    update_annotation,
)


def _mock_db():
    db = MagicMock()
    db.execute.return_value.scalar_one_or_none.return_value = None
    return db


def _make_task(task_id=1, campaign_id=1, geometry_id=10):
    task = MagicMock()
    task.id = task_id
    task.campaign_id = campaign_id
    task.geometry_id = geometry_id
    return task


def _make_annotation(ann_id=1, task_id=1, campaign_id=1, user_id=None, label_id=1):
    ann = MagicMock(spec=Annotation)
    ann.id = ann_id
    ann.annotation_task_id = task_id
    ann.campaign_id = campaign_id
    ann.created_by_user_id = user_id or uuid4()
    ann.label_id = label_id
    ann.comment = None
    ann.confidence = None
    ann.is_authoritative = False
    return ann


def _make_assignment(task_id=1, user_id=None, status="pending"):
    a = MagicMock(spec=AnnotationTaskAssignment)
    a.task_id = task_id
    a.user_id = user_id or uuid4()
    a.status = status
    return a


class TestAddAnnotationForTask:
    """Tests for creating/updating annotations tied to a task."""

    def test_create_new_annotation_with_label(self):
        db = _mock_db()
        user_id = uuid4()
        task = _make_task()

        # no existing annotation, no assignment
        db.execute.return_value.scalar_one_or_none.return_value = None

        payload = AnnotationFromTaskCreate(
            label_id=1, comment="looks good", confidence=3, is_authoritative=None
        )
        add_annotation_for_task(db, task, payload, user_id)

        db.add.assert_called_once()
        added = db.add.call_args[0][0]
        assert isinstance(added, Annotation)
        assert added.label_id == 1
        assert added.comment == "looks good"
        assert added.campaign_id == task.campaign_id
        assert added.created_by_user_id == user_id
        db.commit.assert_called_once()

    def test_create_skip_no_label_no_comment(self):
        """No label and no comment -> nothing created, nothing committed."""
        db = _mock_db()
        user_id = uuid4()
        task = _make_task()

        db.execute.return_value.scalar_one_or_none.return_value = None

        payload = AnnotationFromTaskCreate(label_id=None, comment=None, confidence=None)
        result = add_annotation_for_task(db, task, payload, user_id)

        db.add.assert_not_called()
        assert result is None

    def test_create_with_assignment_marks_done(self):
        db = _mock_db()
        user_id = uuid4()
        task = _make_task()
        assignment = _make_assignment(task_id=task.id, user_id=user_id)

        # first call: no existing annotation; second call: assignment found
        db.execute.return_value.scalar_one_or_none.side_effect = [None, assignment]

        payload = AnnotationFromTaskCreate(label_id=2, comment=None, confidence=None)
        add_annotation_for_task(db, task, payload, user_id)

        assert assignment.status == ANNOTATION_TASK_STATUS_DONE

    def test_create_skip_with_assignment_marks_skipped(self):
        db = _mock_db()
        user_id = uuid4()
        task = _make_task()
        assignment = _make_assignment(task_id=task.id, user_id=user_id)

        db.execute.return_value.scalar_one_or_none.side_effect = [None, assignment]

        payload = AnnotationFromTaskCreate(label_id=None, comment=None, confidence=None)
        add_annotation_for_task(db, task, payload, user_id)

        assert assignment.status == ANNOTATION_TASK_STATUS_SKIPPED

    def test_update_existing_annotation(self):
        db = _mock_db()
        user_id = uuid4()
        task = _make_task()
        existing = _make_annotation(task_id=task.id, user_id=user_id, label_id=1)

        # is_authoritative=True triggers a CampaignUser lookup before the
        # existing-annotation / assignment lookups.
        reviewer_cu = MagicMock()
        reviewer_cu.is_authorative_reviewer = True
        db.execute.return_value.scalar_one_or_none.side_effect = [
            reviewer_cu,
            existing,
            None,
        ]

        payload = AnnotationFromTaskCreate(
            label_id=5, comment="revised", confidence=4, is_authoritative=True
        )
        add_annotation_for_task(db, task, payload, user_id)

        assert existing.label_id == 5
        assert existing.comment == "revised"
        assert existing.confidence == 4
        assert existing.is_authoritative is True
        db.commit.assert_called_once()

    def test_update_existing_remove_label_deletes(self):
        """Submitting label_id=None on an existing annotation deletes it."""
        db = _mock_db()
        user_id = uuid4()
        task = _make_task()
        existing = _make_annotation(task_id=task.id, user_id=user_id, label_id=1)
        assignment = _make_assignment(task_id=task.id, user_id=user_id, status="done")

        db.execute.return_value.scalar_one_or_none.side_effect = [existing, assignment]

        payload = AnnotationFromTaskCreate(label_id=None, comment=None, confidence=None)
        add_annotation_for_task(db, task, payload, user_id)

        db.delete.assert_called_once_with(existing)
        assert assignment.status == ANNOTATION_TASK_STATUS_SKIPPED

    def test_update_existing_with_assignment_marks_done(self):
        db = _mock_db()
        user_id = uuid4()
        task = _make_task()
        existing = _make_annotation(task_id=task.id, user_id=user_id, label_id=1)
        assignment = _make_assignment(task_id=task.id, user_id=user_id, status="pending")

        db.execute.return_value.scalar_one_or_none.side_effect = [existing, assignment]

        payload = AnnotationFromTaskCreate(label_id=3, comment=None, confidence=None)
        add_annotation_for_task(db, task, payload, user_id)

        assert assignment.status == ANNOTATION_TASK_STATUS_DONE

    def test_authoritative_submission_rejected_for_non_reviewer(self):
        """is_authoritative=True from a user who is not an authoritative
        reviewer of the campaign must be rejected with 403, and no annotation
        should be created or committed."""
        db = _mock_db()
        user_id = uuid4()
        task = _make_task()

        non_reviewer_cu = MagicMock()
        non_reviewer_cu.is_authorative_reviewer = False
        db.execute.return_value.scalar_one_or_none.return_value = non_reviewer_cu

        payload = AnnotationFromTaskCreate(
            label_id=1, comment=None, confidence=None, is_authoritative=True
        )

        with pytest.raises(HTTPException) as exc_info:
            add_annotation_for_task(db, task, payload, user_id)

        assert exc_info.value.status_code == 403
        db.add.assert_not_called()
        db.commit.assert_not_called()

    def test_authoritative_submission_rejected_when_not_a_campaign_member(self):
        """A user who is not in the CampaignUser table at all must also be
        rejected when trying to submit authoritatively."""
        db = _mock_db()
        user_id = uuid4()
        task = _make_task()

        # No CampaignUser row -> scalar_one_or_none returns None
        db.execute.return_value.scalar_one_or_none.return_value = None

        payload = AnnotationFromTaskCreate(
            label_id=1, comment=None, confidence=None, is_authoritative=True
        )

        with pytest.raises(HTTPException) as exc_info:
            add_annotation_for_task(db, task, payload, user_id)

        assert exc_info.value.status_code == 403
        db.add.assert_not_called()
        db.commit.assert_not_called()

    def test_authoritative_submission_accepted_for_reviewer(self):
        """A user with the authoritative-reviewer flag can create a fresh
        authoritative annotation, even with no assignment on the task."""
        db = _mock_db()
        user_id = uuid4()
        task = _make_task()

        reviewer_cu = MagicMock()
        reviewer_cu.is_authorative_reviewer = True
        # 1: CampaignUser lookup (reviewer check)
        # 2: existing-annotation lookup -> none
        # 3: assignment lookup -> none (reviewer is unassigned)
        db.execute.return_value.scalar_one_or_none.side_effect = [reviewer_cu, None, None]

        payload = AnnotationFromTaskCreate(
            label_id=7, comment=None, confidence=None, is_authoritative=True
        )
        add_annotation_for_task(db, task, payload, user_id)

        db.add.assert_called_once()
        added = db.add.call_args[0][0]
        assert isinstance(added, Annotation)
        assert added.label_id == 7
        assert added.is_authoritative is True
        assert added.created_by_user_id == user_id
        db.commit.assert_called_once()

    def test_non_authoritative_submission_skips_reviewer_check(self):
        """is_authoritative falsy must not trigger the reviewer lookup, so a
        non-reviewer user can still label normally. The first scalar lookup
        should be the existing-annotation query, not a CampaignUser query."""
        db = _mock_db()
        user_id = uuid4()
        task = _make_task()

        # Only existing-annotation + assignment lookups should run.
        db.execute.return_value.scalar_one_or_none.side_effect = [None, None]

        payload = AnnotationFromTaskCreate(
            label_id=2, comment=None, confidence=None, is_authoritative=False
        )
        add_annotation_for_task(db, task, payload, user_id)

        # Exactly two scalar_one_or_none calls -> no reviewer lookup happened.
        assert db.execute.return_value.scalar_one_or_none.call_count == 2
        db.add.assert_called_once()
        added = db.add.call_args[0][0]
        assert added.is_authoritative is False
        db.commit.assert_called_once()


class TestCreateAnnotation:
    """Tests for creating standalone (non-task) annotations."""

    def test_creates_geometry_and_annotation(self):
        db = _mock_db()
        user_id = uuid4()
        campaign = MagicMock()
        campaign.id = 42

        payload = AnnotationCreate(
            label_id=1, comment="standalone", geometry_wkt="POINT(10 20)", confidence=None
        )

        create_annotation(db, campaign, payload, user_id)

        # Should have added geometry + annotation (2 add calls)
        assert db.add.call_count == 2
        assert db.flush.call_count == 1
        assert db.commit.call_count == 1
        assert db.refresh.call_count == 1

    def test_annotation_has_no_task_link(self):
        db = _mock_db()
        user_id = uuid4()
        campaign = MagicMock()
        campaign.id = 1

        payload = AnnotationCreate(
            label_id=1, comment=None, geometry_wkt="POINT(0 0)", confidence=None
        )
        create_annotation(db, campaign, payload, user_id)

        # The second db.add call is the annotation
        annotation = db.add.call_args_list[1][0][0]
        assert isinstance(annotation, Annotation)
        assert annotation.annotation_task_id is None
        assert annotation.campaign_id == 1

    def test_db_failure_rolls_back(self):
        db = _mock_db()
        db.commit.side_effect = Exception("DB error")
        user_id = uuid4()
        campaign = MagicMock()
        campaign.id = 1

        payload = AnnotationCreate(
            label_id=1, comment=None, geometry_wkt="POINT(0 0)", confidence=None
        )

        with pytest.raises(HTTPException) as exc_info:
            create_annotation(db, campaign, payload, user_id)

        assert exc_info.value.status_code == 400
        db.rollback.assert_called_once()


class TestUpdateAnnotation:
    """Tests for updating an existing annotation."""

    def test_update_label(self):
        db = _mock_db()
        user_id = uuid4()
        existing = _make_annotation(ann_id=5, label_id=1)
        db.execute.return_value.scalar_one_or_none.return_value = existing

        payload = AnnotationUpdate(
            label_id=3, comment=None, geometry_wkt=None, is_authoritative=None
        )
        update_annotation(db, 5, payload, user_id)

        assert existing.label_id == 3
        db.commit.assert_called_once()

    def test_update_comment(self):
        db = _mock_db()
        user_id = uuid4()
        existing = _make_annotation(ann_id=5)
        db.execute.return_value.scalar_one_or_none.return_value = existing

        payload = AnnotationUpdate(
            label_id=None, comment="updated comment", geometry_wkt=None, is_authoritative=None
        )
        update_annotation(db, 5, payload, user_id)

        assert existing.comment == "updated comment"

    def test_update_geometry_creates_new_record(self):
        db = _mock_db()
        user_id = uuid4()
        existing = _make_annotation(ann_id=5)
        existing.geometry_id = 100
        db.execute.return_value.scalar_one_or_none.return_value = existing

        payload = AnnotationUpdate(
            label_id=None,
            comment=None,
            geometry_wkt="POLYGON((0 0,1 0,1 1,0 1,0 0))",
            is_authoritative=None,
        )
        update_annotation(db, 5, payload, user_id)

        # Should have added a new AnnotationGeometry
        added_geom = db.add.call_args[0][0]
        assert isinstance(added_geom, AnnotationGeometry)
        db.flush.assert_called_once()

    def test_update_not_found_raises_404(self):
        db = _mock_db()
        db.execute.return_value.scalar_one_or_none.return_value = None

        payload = AnnotationUpdate(
            label_id=1, comment=None, geometry_wkt=None, is_authoritative=None
        )

        with pytest.raises(HTTPException) as exc_info:
            update_annotation(db, 999, payload, uuid4())

        assert exc_info.value.status_code == 404

    def test_update_preserves_unset_fields(self):
        """Fields set to None in the update payload should not be changed."""
        db = _mock_db()
        user_id = uuid4()
        existing = _make_annotation(ann_id=5, label_id=2)
        existing.comment = "original"
        existing.confidence = 5
        existing.is_authoritative = True
        db.execute.return_value.scalar_one_or_none.return_value = existing

        # Only update confidence
        payload = AnnotationUpdate(
            label_id=None, comment=None, geometry_wkt=None, confidence=1, is_authoritative=None
        )
        update_annotation(db, 5, payload, user_id)

        assert existing.label_id == 2  # unchanged
        assert existing.comment == "original"  # unchanged
        assert existing.confidence == 1  # updated

    def test_db_failure_rolls_back(self):
        db = _mock_db()
        user_id = uuid4()
        existing = _make_annotation(ann_id=5)
        db.execute.return_value.scalar_one_or_none.return_value = existing
        db.commit.side_effect = Exception("DB error")

        payload = AnnotationUpdate(
            label_id=3, comment=None, geometry_wkt=None, is_authoritative=None
        )

        with pytest.raises(HTTPException) as exc_info:
            update_annotation(db, 5, payload, user_id)

        assert exc_info.value.status_code == 400
        db.rollback.assert_called_once()


class TestDeleteAnnotation:
    """Tests for deleting annotations and verifying side effects."""

    def test_delete_standalone_annotation(self):
        db = _mock_db()
        existing = _make_annotation(ann_id=10, task_id=None, campaign_id=1)
        existing.annotation_task_id = None
        db.execute.return_value.scalar_one_or_none.return_value = existing

        delete_annotation(db, 10, campaign_id=1)

        db.delete.assert_called_once_with(existing)
        db.commit.assert_called_once()

    def test_delete_task_annotation_resets_assignment(self):
        """Deleting a task-linked annotation resets assignment to pending."""
        db = _mock_db()
        user_id = uuid4()
        existing = _make_annotation(ann_id=10, task_id=5, campaign_id=1)
        existing.annotation_task_id = 5
        existing.created_by_user_id = user_id
        assignment = _make_assignment(task_id=5, user_id=user_id, status="done")

        # first execute -> find annotation; second execute -> find assignment
        db.execute.return_value.scalar_one_or_none.side_effect = [existing, assignment]

        delete_annotation(db, 10, campaign_id=1)

        assert assignment.status == ANNOTATION_TASK_STATUS_PENDING
        db.delete.assert_called_once_with(existing)

    def test_delete_not_found_raises_404(self):
        db = _mock_db()
        db.execute.return_value.scalar_one_or_none.return_value = None

        with pytest.raises(HTTPException) as exc_info:
            delete_annotation(db, 999, campaign_id=1)

        assert exc_info.value.status_code == 404

    def test_delete_wrong_campaign_raises_404(self):
        """Annotation belongs to campaign 1, request says campaign 2 -> not found."""
        db = _mock_db()
        # query filters by both annotation_id AND campaign_id, so returns None
        db.execute.return_value.scalar_one_or_none.return_value = None

        with pytest.raises(HTTPException) as exc_info:
            delete_annotation(db, 10, campaign_id=2)

        assert exc_info.value.status_code == 404


class TestCreateAnnotationTasksFromCSV:
    """Tests for CSV parsing and validation in task creation."""

    def test_file_too_large_raises_413(self):
        db = _mock_db()
        huge = b"x" * (21 * 1024 * 1024)

        with pytest.raises(HTTPException) as exc_info:
            create_annotation_tasks_from_csv(db, campaign_id=1, contents=huge)

        assert exc_info.value.status_code == 413

    def test_empty_csv_raises_400(self):
        db = _mock_db()

        with pytest.raises(HTTPException) as exc_info:
            create_annotation_tasks_from_csv(db, campaign_id=1, contents=b"")

        assert exc_info.value.status_code == 400

    def test_missing_required_columns_raises_400(self):
        db = _mock_db()
        csv_bytes = b"name,value\nfoo,1\n"

        with pytest.raises(HTTPException) as exc_info:
            create_annotation_tasks_from_csv(db, campaign_id=1, contents=csv_bytes)

        assert exc_info.value.status_code == 400
        assert "columns" in exc_info.value.detail.lower()

    def test_duplicate_ids_raises_400(self):
        db = _mock_db()
        csv_bytes = b"id,lat,lon\n1,10.0,20.0\n1,11.0,21.0\n"

        with pytest.raises(HTTPException) as exc_info:
            create_annotation_tasks_from_csv(db, campaign_id=1, contents=csv_bytes)

        assert exc_info.value.status_code == 400
        assert "duplicate" in exc_info.value.detail.lower()

    def test_invalid_longitude_raises_400(self):
        db = _mock_db()
        csv_bytes = b"id,lat,lon\n1,10.0,200.0\n"

        with pytest.raises(HTTPException) as exc_info:
            create_annotation_tasks_from_csv(db, campaign_id=1, contents=csv_bytes)

        assert exc_info.value.status_code == 400
        assert "longitude" in exc_info.value.detail.lower()

    def test_invalid_latitude_raises_400(self):
        db = _mock_db()
        csv_bytes = b"id,lat,lon\n1,95.0,10.0\n"

        with pytest.raises(HTTPException) as exc_info:
            create_annotation_tasks_from_csv(db, campaign_id=1, contents=csv_bytes)

        assert exc_info.value.status_code == 400
        assert "latitude" in exc_info.value.detail.lower()

    def test_empty_id_raises_400(self):
        db = _mock_db()
        csv_bytes = b"id,lat,lon\n ,10.0,20.0\n"

        with pytest.raises(HTTPException) as exc_info:
            create_annotation_tasks_from_csv(db, campaign_id=1, contents=csv_bytes)

        assert exc_info.value.status_code == 400

    def test_non_utf8_raises_400(self):
        db = _mock_db()
        # invalid UTF-8 byte sequence
        csv_bytes = b"id,lat,lon\n\x80\x81,10.0,20.0\n"

        with pytest.raises(HTTPException) as exc_info:
            create_annotation_tasks_from_csv(db, campaign_id=1, contents=csv_bytes)

        assert exc_info.value.status_code == 400


class TestPublicCampaignAnnotationOwnership:
    """Ensure users in public campaigns can only edit/delete their own annotations."""

    def _make_public_campaign(self):
        campaign = MagicMock()
        campaign.id = 1
        campaign.is_public = True
        return campaign

    def _make_private_campaign(self):
        campaign = MagicMock()
        campaign.id = 1
        campaign.is_public = False
        return campaign

    def test_update_own_annotation_in_public_campaign(self):
        db = _mock_db()
        user_id = uuid4()
        existing = _make_annotation(ann_id=5, user_id=user_id)
        db.execute.return_value.scalar_one_or_none.return_value = existing

        payload = AnnotationUpdate(
            label_id=3, comment=None, geometry_wkt=None, is_authoritative=None
        )
        update_annotation(db, 5, payload, user_id, campaign=self._make_public_campaign())

        assert existing.label_id == 3
        db.commit.assert_called_once()

    def test_update_other_users_annotation_in_public_campaign_raises_403(self):
        db = _mock_db()
        owner_id = uuid4()
        other_user_id = uuid4()
        existing = _make_annotation(ann_id=5, user_id=owner_id)
        # First call returns annotation, subsequent calls return None (not campaign admin)
        db.execute.return_value.scalar_one_or_none.side_effect = [existing, None]
        # is_platform_admin uses .first() - ensure it returns None (not platform admin)
        db.execute.return_value.first.return_value = None

        payload = AnnotationUpdate(
            label_id=3, comment=None, geometry_wkt=None, is_authoritative=None
        )
        with pytest.raises(HTTPException) as exc_info:
            update_annotation(db, 5, payload, other_user_id, campaign=self._make_public_campaign())
        assert exc_info.value.status_code == 403

    def test_update_other_users_annotation_in_private_campaign_allowed(self):
        db = _mock_db()
        owner_id = uuid4()
        other_user_id = uuid4()
        existing = _make_annotation(ann_id=5, user_id=owner_id)
        db.execute.return_value.scalar_one_or_none.return_value = existing

        payload = AnnotationUpdate(
            label_id=3, comment=None, geometry_wkt=None, is_authoritative=None
        )
        update_annotation(db, 5, payload, other_user_id, campaign=self._make_private_campaign())
        assert existing.label_id == 3

    def test_delete_own_annotation_in_public_campaign(self):
        db = _mock_db()
        user_id = uuid4()
        existing = _make_annotation(ann_id=10, task_id=None, campaign_id=1, user_id=user_id)
        existing.annotation_task_id = None
        db.execute.return_value.scalar_one_or_none.return_value = existing

        delete_annotation(
            db, 10, campaign_id=1, user_id=user_id, campaign=self._make_public_campaign()
        )
        db.delete.assert_called_once_with(existing)

    def test_delete_other_users_annotation_in_public_campaign_raises_403(self):
        db = _mock_db()
        owner_id = uuid4()
        other_user_id = uuid4()
        existing = _make_annotation(ann_id=10, task_id=None, campaign_id=1, user_id=owner_id)
        existing.annotation_task_id = None
        # First call returns annotation, subsequent calls return None (not campaign admin)
        db.execute.return_value.scalar_one_or_none.side_effect = [existing, None]
        # is_platform_admin uses .first() - ensure it returns None (not platform admin)
        db.execute.return_value.first.return_value = None

        with pytest.raises(HTTPException) as exc_info:
            delete_annotation(
                db, 10, campaign_id=1, user_id=other_user_id, campaign=self._make_public_campaign()
            )
        assert exc_info.value.status_code == 403

    def test_delete_other_users_annotation_in_private_campaign_allowed(self):
        db = _mock_db()
        owner_id = uuid4()
        other_user_id = uuid4()
        existing = _make_annotation(ann_id=10, task_id=None, campaign_id=1, user_id=owner_id)
        existing.annotation_task_id = None
        db.execute.return_value.scalar_one_or_none.return_value = existing

        delete_annotation(
            db, 10, campaign_id=1, user_id=other_user_id, campaign=self._make_private_campaign()
        )
        db.delete.assert_called_once_with(existing)
