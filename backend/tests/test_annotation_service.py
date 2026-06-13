"""Tests for annotation service layer."""

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from uuid import uuid4

import numpy as np
import pytest
from fastapi import HTTPException
from geoalchemy2.elements import WKTElement

from src.annotation.constants import (
    ANNOTATION_TASK_STATUS_DONE,
    ANNOTATION_TASK_STATUS_PENDING,
    ANNOTATION_TASK_STATUS_SKIPPED,
    CLAIM_TTL_MINUTES,
)
from src.annotation.models import Annotation, AnnotationGeometry, AnnotationTaskAssignment
from src.annotation.schemas import AnnotationCreate, AnnotationFromTaskCreate, AnnotationUpdate
from src.annotation.service import (
    _build_annotation_records,
    add_annotation_for_task,
    build_annotations_export,
    build_annotations_geojson_export,
    claim_task_for_user,
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

    def test_creates_geometry_then_annotation_with_user_payload(self):
        db = _mock_db()
        user_id = uuid4()
        campaign = MagicMock()
        campaign.id = 42

        # Have flush() populate the geometry id the way the real DB would,
        # so the test can verify that id is wired into the Annotation.
        def _flush_sets_geom_id():
            added = [c.args[0] for c in db.add.call_args_list]
            for obj in added:
                if isinstance(obj, AnnotationGeometry) and obj.id is None:
                    obj.id = 7777

        db.flush.side_effect = _flush_sets_geom_id

        payload = AnnotationCreate(
            label_id=1, comment="standalone", geometry_wkt="POINT(10 20)", confidence=None
        )
        create_annotation(db, campaign, payload, user_id)

        added = [c.args[0] for c in db.add.call_args_list]
        geoms = [o for o in added if isinstance(o, AnnotationGeometry)]
        anns = [o for o in added if isinstance(o, Annotation)]

        assert len(geoms) == 1
        assert len(anns) == 1

        geom, ann = geoms[0], anns[0]

        assert "POINT(10 20)" in str(geom.geometry)

        assert ann.label_id == 1
        assert ann.comment == "standalone"
        assert ann.campaign_id == 42
        assert ann.created_by_user_id == user_id
        assert ann.geometry_id == geom.id

    def test_persists_imagery_snapshot(self):
        db = _mock_db()
        campaign = MagicMock()
        campaign.id = 1

        payload = AnnotationCreate(
            label_id=1,
            comment=None,
            geometry_wkt="POINT(0 0)",
            confidence=None,
            imagery_slice_id=42,
            imagery_source_name="Sentinel-2",
            imagery_start_date="2024-01-01",
            imagery_end_date="2024-01-31",
        )
        create_annotation(db, campaign, payload, uuid4())

        annotation = db.add.call_args_list[1][0][0]
        assert annotation.imagery_slice_id == 42
        assert annotation.imagery_source_name == "Sentinel-2"
        assert annotation.imagery_start_date == "2024-01-01"
        assert annotation.imagery_end_date == "2024-01-31"

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

    def test_geometry_update_refreshes_imagery_snapshot(self):
        db = _mock_db()
        existing = _make_annotation(ann_id=5)
        existing.imagery_slice_id = 1
        existing.imagery_source_name = "Old Source"
        existing.imagery_start_date = "2020-01-01"
        existing.imagery_end_date = "2020-01-31"
        db.execute.return_value.scalar_one_or_none.return_value = existing

        payload = AnnotationUpdate(
            label_id=None,
            comment=None,
            geometry_wkt="POLYGON((0 0,1 0,1 1,0 1,0 0))",
            is_authoritative=None,
            imagery_slice_id=99,
            imagery_source_name="New Source",
            imagery_start_date="2024-06-01",
            imagery_end_date="2024-06-30",
        )
        update_annotation(db, 5, payload, uuid4())

        assert existing.imagery_slice_id == 99
        assert existing.imagery_source_name == "New Source"
        assert existing.imagery_start_date == "2024-06-01"
        assert existing.imagery_end_date == "2024-06-30"

    def test_non_geometry_update_leaves_imagery_snapshot(self):
        db = _mock_db()
        existing = _make_annotation(ann_id=5)
        existing.imagery_slice_id = 1
        existing.imagery_source_name = "Old Source"
        existing.imagery_start_date = "2020-01-01"
        existing.imagery_end_date = "2020-01-31"
        db.execute.return_value.scalar_one_or_none.return_value = existing

        # Flag-only update carries imagery fields but no geometry: must not touch
        # the snapshot captured at draw time.
        payload = AnnotationUpdate(
            label_id=None,
            comment=None,
            geometry_wkt=None,
            is_authoritative=None,
            flagged_for_review=True,
            imagery_slice_id=99,
            imagery_source_name="New Source",
            imagery_start_date="2024-06-01",
            imagery_end_date="2024-06-30",
        )
        update_annotation(db, 5, payload, uuid4())

        assert existing.imagery_slice_id == 1
        assert existing.imagery_source_name == "Old Source"
        assert existing.imagery_start_date == "2020-01-01"
        assert existing.imagery_end_date == "2020-01-31"

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


class TestExportAnnotatorCount:
    """Regression tests for stacnotator_annotator_count in CSV/GeoJSON exports.

    Was hard-coded to 1 on the per-annotation (non-merged) path, hiding the
    fact that multiple annotators contributed to a task. The fix threads the
    per-task labeled-annotation count through, so downstream agreement
    analyses can be derived from the export even without merge_on_agreement.

    The pure-Python record builders are exercised directly via
    ``_build_annotation_records``; ``_compute_task_status_for_export`` is
    patched out so we don't need fully ORM-shaped task objects (it goes
    through pydantic ``AnnotationTaskOut.model_validate``).
    """

    @staticmethod
    def _campaign():
        # _resolve_label_name reads campaign.settings.labels; an empty dict
        # is enough for these tests (no label_name assertions).
        return SimpleNamespace(settings=SimpleNamespace(labels={}))

    @staticmethod
    def _task(task_id=1, annotation_number=42):
        return SimpleNamespace(
            id=task_id,
            annotation_number=annotation_number,
            raw_source_data=None,
        )

    @staticmethod
    def _ann(*, ann_id, label_id, user_id, task=None, **overrides):
        ann = SimpleNamespace(
            id=ann_id,
            label_id=label_id,
            comment=None,
            confidence=None,
            is_authoritative=False,
            flagged_for_review=False,
            flag_comment=None,
            created_by_user_id=user_id,
            created_at=datetime(2026, 5, 6, tzinfo=UTC),
            annotation_task_id=task.id if task else None,
            campaign_id=1,
            annotation_task=task,
            geometry=None,
            imagery_slice_id=None,
            imagery_source_name=None,
            imagery_start_date=None,
            imagery_end_date=None,
        )
        for k, v in overrides.items():
            setattr(ann, k, v)
        return ann

    def _records(self, annotations, *, merge=False):
        with patch(
            "src.annotation.service._compute_task_status_for_export",
            return_value="done",
        ):
            records, _ = _build_annotation_records(
                annotations=annotations,
                campaign=self._campaign(),
                user_email_map={},
                merge_on_agreement=merge,
                include_geometry_wkt=False,
            )
        return records

    def test_single_labeled_annotator_non_merged(self):
        task = self._task()
        ann = self._ann(ann_id=1, label_id=1, user_id=uuid4(), task=task)
        rows = self._records([ann])
        assert [r["stacnotator_annotator_count"] for r in rows] == [1]

    def test_two_labeled_annotators_share_count_non_merged(self):
        """Two labeled annotators on the same task -> both rows show count=2."""
        task = self._task()
        a1 = self._ann(ann_id=1, label_id=1, user_id=uuid4(), task=task)
        a2 = self._ann(ann_id=2, label_id=1, user_id=uuid4(), task=task)
        rows = self._records([a1, a2])
        assert len(rows) == 2
        assert all(r["stacnotator_annotator_count"] == 2 for r in rows)
        # Sanity: both rows reference the same task so the count is per-task.
        assert {r["stacnotator_task_id"] for r in rows} == {task.id}

    def test_labeled_plus_authoritative_share_count_non_merged(self):
        """Authoritative annotation is just another labeled row -> count includes it."""
        task = self._task()
        a1 = self._ann(ann_id=1, label_id=1, user_id=uuid4(), task=task)
        a2 = self._ann(
            ann_id=2,
            label_id=2,
            user_id=uuid4(),
            task=task,
            is_authoritative=True,
        )
        rows = self._records([a1, a2])
        assert all(r["stacnotator_annotator_count"] == 2 for r in rows)

    def test_comment_only_does_not_inflate_count(self):
        """A label-less (comment-only) annotation isn't a labeled annotator."""
        task = self._task()
        labeled = self._ann(ann_id=1, label_id=1, user_id=uuid4(), task=task)
        commenter = self._ann(
            ann_id=2,
            label_id=None,
            user_id=uuid4(),
            task=task,
            comment="not sure",
        )
        rows = self._records([labeled, commenter])
        assert len(rows) == 2
        assert all(r["stacnotator_annotator_count"] == 1 for r in rows)

    def test_standalone_open_mode_annotation_count_is_one(self):
        """Standalone (no task) annotations are emitted unchanged with count=1."""
        ann = self._ann(ann_id=1, label_id=1, user_id=uuid4(), task=None)
        rows = self._records([ann])
        assert rows[0]["stacnotator_annotator_count"] == 1

    def test_merged_path_unchanged(self):
        """Sanity: merged path still aggregates to len(labeled)."""
        task = self._task()
        a1 = self._ann(ann_id=1, label_id=1, user_id=uuid4(), task=task)
        a2 = self._ann(ann_id=2, label_id=1, user_id=uuid4(), task=task)
        rows = self._records([a1, a2], merge=True)
        assert len(rows) == 1
        assert rows[0]["stacnotator_annotator_count"] == 2

    def test_per_task_count_is_isolated_across_tasks(self):
        """Two separate tasks: one with 2 annotators, one with 1, don't bleed."""
        task_a = self._task(task_id=1, annotation_number=10)
        task_b = self._task(task_id=2, annotation_number=11)
        a1 = self._ann(ann_id=1, label_id=1, user_id=uuid4(), task=task_a)
        a2 = self._ann(ann_id=2, label_id=1, user_id=uuid4(), task=task_a)
        b1 = self._ann(ann_id=3, label_id=1, user_id=uuid4(), task=task_b)
        rows = self._records([a1, a2, b1])
        by_task: dict[int, list[int]] = {}
        for r in rows:
            by_task.setdefault(r["stacnotator_task_id"], []).append(
                r["stacnotator_annotator_count"]
            )
        assert by_task[task_a.id] == [2, 2]
        assert by_task[task_b.id] == [1]


class TestExportMergeCorrectness:
    """Correctness of label export and merge-on-agreement, including edge cases.

    Exercises the real ``build_annotations_export`` / ``build_annotations_geojson_export``
    (so the conflict guard, column ordering and DataFrame/GeoJSON assembly are
    covered) with the DB access (``_fetch_annotations_with_context``) and the
    pydantic-backed status helper patched out. Annotations/tasks/campaign are
    light ``SimpleNamespace`` stand-ins matching the attributes the export code
    actually reads.
    """

    LABELS = {
        "1": {"name": "Forest"},
        "2": {"name": "Water"},
        "3": {"name": "Urban"},
    }

    # ---- builders -------------------------------------------------------

    @classmethod
    def _campaign(cls, labels=None):
        return SimpleNamespace(
            id=1, settings=SimpleNamespace(labels=cls.LABELS if labels is None else labels)
        )

    @staticmethod
    def _task(task_id=1, annotation_number=42, raw_source_data=None):
        return SimpleNamespace(
            id=task_id, annotation_number=annotation_number, raw_source_data=raw_source_data
        )

    @staticmethod
    def _geom(wkt):
        # Mirrors the ORM shape: annotation.geometry.geometry is the geo element.
        return SimpleNamespace(geometry=WKTElement(wkt, srid=4326))

    @staticmethod
    def _ann(*, ann_id, label_id, user_id=None, task=None, geometry=None, **overrides):
        ann = SimpleNamespace(
            id=ann_id,
            label_id=label_id,
            comment=None,
            confidence=None,
            is_authoritative=False,
            flagged_for_review=False,
            flag_comment=None,
            created_by_user_id=user_id or uuid4(),
            created_at=datetime(2026, 5, 6, tzinfo=UTC),
            annotation_task_id=task.id if task else None,
            campaign_id=1,
            annotation_task=task,
            geometry=geometry,
            imagery_slice_id=None,
            imagery_source_name=None,
            imagery_start_date=None,
            imagery_end_date=None,
        )
        for k, v in overrides.items():
            setattr(ann, k, v)
        return ann

    def _csv(self, annotations, *, merge=False, campaign=None, email_map=None):
        campaign = campaign or self._campaign()
        with (
            patch(
                "src.annotation.service._fetch_annotations_with_context",
                return_value=(annotations, email_map or {}),
            ),
            patch(
                "src.annotation.service._compute_task_status_for_export",
                return_value="done",
            ),
        ):
            return build_annotations_export(MagicMock(), campaign, merge_on_agreement=merge)

    def _geojson(self, annotations, *, merge=False, campaign=None, email_map=None):
        campaign = campaign or self._campaign()
        with (
            patch(
                "src.annotation.service._fetch_annotations_with_context",
                return_value=(annotations, email_map or {}),
            ),
            patch(
                "src.annotation.service._compute_task_status_for_export",
                return_value="done",
            ),
        ):
            return build_annotations_geojson_export(MagicMock(), campaign, merge_on_agreement=merge)

    # ---- merge: agreement collapse -------------------------------------

    def test_merge_collapses_agreeing_task_to_single_row(self):
        task = self._task()
        a1 = self._ann(ann_id=1, label_id=1, user_id=uuid4(), task=task)
        a2 = self._ann(ann_id=2, label_id=1, user_id=uuid4(), task=task)
        df = self._csv([a1, a2], merge=True)

        assert len(df) == 1
        row = df.iloc[0]
        assert row["stacnotator_label_id"] == 1
        assert row["stacnotator_label_name"] == "Forest"
        assert row["stacnotator_annotator_count"] == 2
        assert row["stacnotator_task_id"] == task.id
        # Merged rows drop the single-annotation id; task_id is the join key.
        assert "stacnotator_annotation_id" not in df.columns

    def test_non_merged_keeps_one_row_per_annotation_with_ids(self):
        task = self._task()
        a1 = self._ann(ann_id=1, label_id=1, user_id=uuid4(), task=task)
        a2 = self._ann(ann_id=2, label_id=1, user_id=uuid4(), task=task)
        df = self._csv([a1, a2], merge=False)

        assert len(df) == 2
        assert set(df["stacnotator_annotation_id"]) == {1, 2}
        assert set(df["stacnotator_label_name"]) == {"Forest"}

    def test_standalone_annotation_exports_imagery_snapshot(self):
        # Open-mode annotation (no task) carrying the imagery it was drawn on.
        ann = self._ann(
            ann_id=1,
            label_id=1,
            geometry=self._geom("POINT(10 20)"),
            imagery_source_name="Sentinel-2",
            imagery_start_date="2024-01-01",
            imagery_end_date="2024-01-31",
        )

        row = self._csv([ann]).iloc[0]
        assert row["stacnotator_imagery_source_name"] == "Sentinel-2"
        assert row["stacnotator_imagery_start_date"] == "2024-01-01"
        assert row["stacnotator_imagery_end_date"] == "2024-01-31"

        props = self._geojson([ann])["features"][0]["properties"]
        assert props["stacnotator_imagery_source_name"] == "Sentinel-2"
        assert props["stacnotator_imagery_start_date"] == "2024-01-01"
        assert props["stacnotator_imagery_end_date"] == "2024-01-31"

    def test_merge_aggregates_comment_confidence_email_and_latest_time(self):
        u1, u2 = uuid4(), uuid4()
        email_map = {u1: "alice@example.com", u2: "bob@example.com"}
        task = self._task()
        a1 = self._ann(
            ann_id=1,
            label_id=1,
            user_id=u1,
            task=task,
            comment="looks like forest",
            confidence=6,
            created_at=datetime(2026, 5, 6, tzinfo=UTC),
        )
        a2 = self._ann(
            ann_id=2,
            label_id=1,
            user_id=u2,
            task=task,
            comment="agree",
            confidence=8,
            created_at=datetime(2026, 5, 9, tzinfo=UTC),
        )
        row = self._csv([a1, a2], merge=True, email_map=email_map).iloc[0]

        assert row["stacnotator_confidence"] == 7.0  # mean of 6 and 8
        assert row["stacnotator_comment"] == (
            "alice@example.com: looks like forest | bob@example.com: agree"
        )
        assert row["stacnotator_created_by_user_email"] == "alice@example.com, bob@example.com"
        assert row["stacnotator_created_at"] == datetime(2026, 5, 9, tzinfo=UTC)  # latest

    def test_merge_is_authoritative_and_flag_are_ored(self):
        u1, u2 = uuid4(), uuid4()
        task = self._task()
        a1 = self._ann(ann_id=1, label_id=1, user_id=u1, task=task)
        a2 = self._ann(
            ann_id=2,
            label_id=1,
            user_id=u2,
            task=task,
            is_authoritative=True,
            flagged_for_review=True,
            flag_comment="verify",
        )
        row = self._csv([a1, a2], merge=True, email_map={u2: "rev@x.com"}).iloc[0]

        assert bool(row["stacnotator_is_authoritative"]) is True
        assert bool(row["stacnotator_flagged_for_review"]) is True
        assert row["stacnotator_flag_comment"] == "rev@x.com: verify"

    # ---- merge: conflict handling --------------------------------------

    def test_merge_on_conflict_raises_400_listing_task(self):
        task = self._task(annotation_number=42)
        a1 = self._ann(ann_id=1, label_id=1, user_id=uuid4(), task=task)
        a2 = self._ann(ann_id=2, label_id=2, user_id=uuid4(), task=task)
        with pytest.raises(HTTPException) as exc:
            self._csv([a1, a2], merge=True)
        assert exc.value.status_code == 400
        assert "conflicting" in exc.value.detail
        assert "#42" in exc.value.detail

    def test_conflict_is_allowed_when_merge_is_off(self):
        task = self._task()
        a1 = self._ann(ann_id=1, label_id=1, user_id=uuid4(), task=task)
        a2 = self._ann(ann_id=2, label_id=2, user_id=uuid4(), task=task)
        df = self._csv([a1, a2], merge=False)  # no raise
        assert len(df) == 2
        assert set(df["stacnotator_label_name"]) == {"Forest", "Water"}

    def test_authoritative_label_resolves_conflict_for_merge(self):
        """A task the app shows as 'done' via an authoritative reviewer must be
        mergeable: the authoritative label wins and there is no 400.

        (Consistent with task-status: see TestAuthoritativeOverride.)
        """
        u1, u2, reviewer = uuid4(), uuid4(), uuid4()
        task = self._task(annotation_number=7)
        a1 = self._ann(ann_id=1, label_id=1, user_id=u1, task=task)
        a2 = self._ann(ann_id=2, label_id=2, user_id=u2, task=task)
        auth = self._ann(ann_id=3, label_id=3, user_id=reviewer, task=task, is_authoritative=True)
        df = self._csv([a1, a2, auth], merge=True)
        assert len(df) == 1
        assert df.iloc[0]["stacnotator_label_id"] == 3  # authoritative wins
        assert df.iloc[0]["stacnotator_label_name"] == "Urban"

    def test_single_labeled_annotator_is_not_merged_even_with_merge_on(self):
        """One label + one comment-only annotation: nothing to merge, so the
        non-merged path runs and annotation ids are preserved."""
        task = self._task()
        labeled = self._ann(ann_id=1, label_id=1, user_id=uuid4(), task=task)
        commenter = self._ann(ann_id=2, label_id=None, user_id=uuid4(), task=task, comment="unsure")
        df = self._csv([labeled, commenter], merge=True)
        assert len(df) == 2
        assert set(df["stacnotator_annotation_id"]) == {1, 2}

    def test_conflict_message_truncates_after_ten_tasks(self):
        anns = []
        for n in range(1, 13):  # 12 conflicting tasks
            task = self._task(task_id=n, annotation_number=n)
            anns.append(self._ann(ann_id=n * 10, label_id=1, user_id=uuid4(), task=task))
            anns.append(self._ann(ann_id=n * 10 + 1, label_id=2, user_id=uuid4(), task=task))
        with pytest.raises(HTTPException) as exc:
            self._csv(anns, merge=True)
        assert "and 2 more" in exc.value.detail

    # ---- label resolution / standalone / columns -----------------------

    def test_unknown_label_id_resolves_to_none(self):
        a = self._ann(ann_id=1, label_id=99, user_id=uuid4(), task=None)
        row = self._csv([a]).iloc[0]
        assert row["stacnotator_label_id"] == 99
        assert row["stacnotator_label_name"] is None

    def test_comment_only_row_has_null_label(self):
        a = self._ann(ann_id=1, label_id=None, user_id=uuid4(), task=None, comment="note")
        row = self._csv([a]).iloc[0]
        assert row["stacnotator_label_id"] is None
        assert row["stacnotator_label_name"] is None
        assert row["stacnotator_comment"] == "note"
        assert row["stacnotator_annotator_count"] == 1

    def test_standalone_open_mode_has_no_task_columns(self):
        a = self._ann(ann_id=1, label_id=1, user_id=uuid4(), task=None)
        df = self._csv([a])
        assert len(df) == 1
        assert "stacnotator_task_id" not in df.columns
        assert df.iloc[0]["stacnotator_annotation_id"] == 1

    def test_column_order_annotation_number_first_then_raw_source_data(self):
        task = self._task(raw_source_data={"plot": "A7", "source_ndvi": 0.42})
        a = self._ann(ann_id=1, label_id=1, user_id=uuid4(), task=task)
        cols = list(self._csv([a]).columns)
        assert cols[0] == "stacnotator_annotation_number"
        # Raw ingest columns come after all stacnotator-generated columns.
        assert cols.index("plot") > cols.index("stacnotator_annotation_id")
        assert "source_ndvi" in cols

    # ---- geometry / GeoJSON --------------------------------------------

    def test_geometry_wkt_included_when_present(self):
        a = self._ann(
            ann_id=1,
            label_id=1,
            user_id=uuid4(),
            task=None,
            geometry=self._geom("POINT(30.5 50.5)"),
        )
        wkt = self._csv([a]).iloc[0]["stacnotator_geometry_wkt"]
        assert "POINT" in wkt and "30.5" in wkt and "50.5" in wkt

    def test_geometry_wkt_is_none_when_absent(self):
        a = self._ann(ann_id=1, label_id=1, user_id=uuid4(), task=None, geometry=None)
        val = self._csv([a]).iloc[0]["stacnotator_geometry_wkt"]
        assert val is None or (isinstance(val, float) and np.isnan(val))

    def test_geojson_feature_collection_shape_and_geometry(self):
        a = self._ann(
            ann_id=1,
            label_id=1,
            user_id=uuid4(),
            task=None,
            geometry=self._geom("POINT(30.5 50.5)"),
        )
        fc = self._geojson([a])
        assert fc["type"] == "FeatureCollection"
        assert len(fc["features"]) == 1
        feat = fc["features"][0]
        assert feat["geometry"]["type"] == "Point"
        assert list(feat["geometry"]["coordinates"]) == [30.5, 50.5]
        assert feat["properties"]["stacnotator_label_name"] == "Forest"
        # datetimes are coerced to ISO strings for JSON-safety.
        assert isinstance(feat["properties"]["stacnotator_created_at"], str)

    def test_geojson_merged_uses_authoritative_geometry(self):
        u1, reviewer = uuid4(), uuid4()
        task = self._task()
        a1 = self._ann(
            ann_id=1,
            label_id=1,
            user_id=u1,
            task=task,
            geometry=self._geom("POINT(10 10)"),
        )
        auth = self._ann(
            ann_id=2,
            label_id=1,
            user_id=reviewer,
            task=task,
            is_authoritative=True,
            geometry=self._geom("POINT(20 20)"),
        )
        fc = self._geojson([a1, auth], merge=True)
        assert len(fc["features"]) == 1
        # Canonical (authoritative) annotation's geometry is used.
        assert list(fc["features"][0]["geometry"]["coordinates"]) == [20.0, 20.0]

    def test_geojson_geometry_none_when_absent(self):
        a = self._ann(ann_id=1, label_id=1, user_id=uuid4(), task=None, geometry=None)
        fc = self._geojson([a])
        assert fc["features"][0]["geometry"] is None


def _claim_assignment(user_id, status=ANNOTATION_TASK_STATUS_PENDING, claimed_at=None):
    a = MagicMock(spec=AnnotationTaskAssignment)
    a.task_id = 1
    a.user_id = user_id
    a.status = status
    a.claimed_at = claimed_at
    return a


def _result(scalar=None, first=None, all_=None):
    """A stand-in for db.execute()'s return value covering the access patterns used."""
    r = MagicMock()
    r.scalar_one_or_none.return_value = scalar
    r.first.return_value = first
    r.scalars.return_value.all.return_value = all_ or []
    return r


class TestClaimTaskForUser:
    """Tests for dwell-based soft claiming of unassigned tasks."""

    def test_claim_unassigned_creates_assignment(self):
        db = _mock_db()
        user_id = uuid4()
        task = _make_task()
        db.execute.side_effect = [
            _result(scalar=task),  # lock task row
            _result(first=None),  # no annotation
            _result(all_=[]),  # no assignments
            _result(all_=[]),  # no other soft claims to release
        ]

        result = claim_task_for_user(db, campaign_id=1, task_id=1, user_id=user_id)

        added = db.add.call_args[0][0]
        assert isinstance(added, AnnotationTaskAssignment)
        assert added.user_id == user_id
        assert added.status == ANNOTATION_TASK_STATUS_PENDING
        assert added.claimed_at is not None
        db.commit.assert_called_once()
        assert result is added

    def test_claim_locked_task_raises_409(self):
        db = _mock_db()
        db.execute.side_effect = [_result(scalar=None)]  # skip_locked -> no row
        with pytest.raises(HTTPException) as exc:
            claim_task_for_user(db, campaign_id=1, task_id=1, user_id=uuid4())
        assert exc.value.status_code == 409

    def test_claim_already_annotated_raises_409(self):
        db = _mock_db()
        task = _make_task()
        db.execute.side_effect = [
            _result(scalar=task),
            _result(first=(1,)),  # an annotation exists
        ]
        with pytest.raises(HTTPException) as exc:
            claim_task_for_user(db, campaign_id=1, task_id=1, user_id=uuid4())
        assert exc.value.status_code == 409

    def test_claim_admin_assignment_of_other_raises_409(self):
        db = _mock_db()
        task = _make_task()
        other = _claim_assignment(uuid4(), claimed_at=None)  # admin assignment
        db.execute.side_effect = [
            _result(scalar=task),
            _result(first=None),
            _result(all_=[other]),
        ]
        with pytest.raises(HTTPException) as exc:
            claim_task_for_user(db, campaign_id=1, task_id=1, user_id=uuid4())
        assert exc.value.status_code == 409
        db.add.assert_not_called()

    def test_claim_active_other_claim_raises_409(self):
        db = _mock_db()
        task = _make_task()
        other = _claim_assignment(uuid4(), claimed_at=datetime.now(UTC))  # fresh claim
        db.execute.side_effect = [
            _result(scalar=task),
            _result(first=None),
            _result(all_=[other]),
        ]
        with pytest.raises(HTTPException) as exc:
            claim_task_for_user(db, campaign_id=1, task_id=1, user_id=uuid4())
        assert exc.value.status_code == 409
        db.delete.assert_not_called()

    def test_claim_stale_other_claim_is_taken_over(self):
        db = _mock_db()
        user_id = uuid4()
        task = _make_task()
        stale = _claim_assignment(
            uuid4(),
            claimed_at=datetime.now(UTC) - timedelta(minutes=CLAIM_TTL_MINUTES + 1),
        )
        db.execute.side_effect = [
            _result(scalar=task),
            _result(first=None),
            _result(all_=[stale]),
            _result(all_=[]),  # no other soft claims to release
        ]

        claim_task_for_user(db, campaign_id=1, task_id=1, user_id=user_id)

        db.delete.assert_called_once_with(stale)
        added = db.add.call_args[0][0]
        assert added.user_id == user_id

    def test_claim_own_existing_refreshes_lease(self):
        db = _mock_db()
        user_id = uuid4()
        task = _make_task()
        mine = _claim_assignment(user_id, claimed_at=datetime.now(UTC) - timedelta(minutes=5))
        db.execute.side_effect = [
            _result(scalar=task),
            _result(first=None),
            _result(all_=[mine]),
            _result(all_=[]),  # no other soft claims to release
        ]

        result = claim_task_for_user(db, campaign_id=1, task_id=1, user_id=user_id)

        assert result is mine
        assert mine.claimed_at is not None
        db.add.assert_not_called()
        db.commit.assert_called_once()

    def test_claim_releases_prior_soft_claim_in_campaign(self):
        """Claiming a new task moves the claim: the caller's prior soft claim is dropped."""
        db = _mock_db()
        user_id = uuid4()
        task = _make_task(task_id=2)
        prior = _claim_assignment(user_id, claimed_at=datetime.now(UTC))
        prior.task_id = 1
        db.execute.side_effect = [
            _result(scalar=task),  # lock task 2
            _result(first=None),  # no annotation on task 2
            _result(all_=[]),  # no assignment on task 2 yet
            _result(all_=[prior]),  # caller's prior soft claim on task 1
        ]

        claim_task_for_user(db, campaign_id=1, task_id=2, user_id=user_id)

        db.delete.assert_called_once_with(prior)
        added = db.add.call_args[0][0]
        assert added.task_id == 2
        assert added.user_id == user_id
