"""Unit tests for labelling-policy enforcement on the annotation write paths
(explore / assigned_tasks / unassigned_tasks axes) and the
counts_toward_completion attachment helpers that back completion semantics.

DB-free per repo convention: campaigns/tasks/annotations are MagicMock or
SimpleNamespace stand-ins, and the DB session is a MagicMock.
"""

from types import SimpleNamespace
from unittest.mock import MagicMock
from uuid import uuid4

import pytest
from fastapi import HTTPException

from src.annotation.schemas import AnnotationCreate, AnnotationFromTaskCreate, AnnotationUpdate
from src.annotation.service import (
    _attach_counts_toward_completion,
    add_annotation_for_task,
    attach_counts_toward_completion_flat,
    create_annotation,
    create_annotations_bulk,
    update_annotation,
)
from src.campaigns.schemas import LabellingPolicy, PolicyAudience


def _campaign(policy: LabellingPolicy | None = None, *, campaign_id=1, is_public=False):
    campaign = MagicMock()
    campaign.id = campaign_id
    campaign.is_public = is_public
    campaign.settings.labels = {"1": {"name": "Forest"}}
    campaign.settings.labelling_policy = (
        policy.model_dump(mode="json") if policy is not None else None
    )
    return campaign


def _db(cu=None):
    """A MagicMock db where the CampaignUser membership lookup
    (`db.scalars(...).first()`) and auth.service.is_admin's platform-role
    check (`db.execute(...).first()`) - two independent mock chains - both
    default to "no", and the generic `scalar_one_or_none()` chain (used for
    existing-annotation/assignment lookups) defaults to "not found"."""
    db = MagicMock()
    db.execute.return_value.scalar_one_or_none.return_value = None
    db.execute.return_value.first.return_value = None
    db.scalars.return_value.first.return_value = cu
    return db


_MEMBER = SimpleNamespace(is_admin=False, is_authorative_reviewer=False)
_ADMIN = SimpleNamespace(is_admin=True, is_authorative_reviewer=False)


class TestExploreAxisEnforcement:
    """create-annotation / batch-create / update (standalone) gate on `explore`."""

    def test_create_annotation_denied_for_non_member(self):
        campaign = _campaign(LabellingPolicy(explore=PolicyAudience(kinds=["members"])))
        db = _db(cu=None)
        payload = AnnotationCreate(
            label_id=1, comment=None, geometry_wkt="POINT(0 0)", confidence=None
        )

        with pytest.raises(HTTPException) as exc:
            create_annotation(db, campaign, payload, uuid4())

        assert exc.value.status_code == 403
        db.add.assert_not_called()

    def test_create_annotation_allowed_for_member(self):
        campaign = _campaign(LabellingPolicy(explore=PolicyAudience(kinds=["members"])))
        db = _db(cu=_MEMBER)
        payload = AnnotationCreate(
            label_id=1, comment=None, geometry_wkt="POINT(0 0)", confidence=None
        )

        create_annotation(db, campaign, payload, uuid4())

        db.add.assert_called()

    def test_create_annotation_denied_when_explore_is_no_one_even_for_admin(self):
        campaign = _campaign(LabellingPolicy(explore=PolicyAudience(kinds=[])))
        db = _db(cu=_ADMIN)
        payload = AnnotationCreate(
            label_id=1, comment=None, geometry_wkt="POINT(0 0)", confidence=None
        )

        with pytest.raises(HTTPException) as exc:
            create_annotation(db, campaign, payload, uuid4())

        assert exc.value.status_code == 403

    def test_create_annotation_denied_falls_back_to_default_policy_when_unset(self):
        """No labelling_policy stored (legacy campaign) -> default policy
        (explore=members) applies; a non-member is still denied."""
        campaign = _campaign(policy=None)
        db = _db(cu=None)
        payload = AnnotationCreate(
            label_id=1, comment=None, geometry_wkt="POINT(0 0)", confidence=None
        )

        with pytest.raises(HTTPException) as exc:
            create_annotation(db, campaign, payload, uuid4())

        assert exc.value.status_code == 403

    def test_create_annotations_bulk_denied_for_non_member(self):
        campaign = _campaign(LabellingPolicy(explore=PolicyAudience(kinds=["members"])))
        db = _db(cu=None)
        payloads = [
            AnnotationCreate(label_id=1, comment=None, geometry_wkt="POINT(0 0)", confidence=None)
        ]

        with pytest.raises(HTTPException) as exc:
            create_annotations_bulk(db, campaign, payloads, uuid4())

        assert exc.value.status_code == 403
        db.add_all.assert_not_called()

    def test_create_annotations_bulk_empty_list_skips_policy_check(self):
        campaign = _campaign(LabellingPolicy(explore=PolicyAudience(kinds=[])))
        db = _db(cu=None)

        assert create_annotations_bulk(db, campaign, [], uuid4()) == 0

    def test_update_annotation_denied_for_non_member(self):
        campaign = _campaign(LabellingPolicy(explore=PolicyAudience(kinds=["members"])))
        db = _db(cu=None)
        existing = MagicMock()
        existing.created_by_user_id = uuid4()
        db.execute.return_value.scalar_one_or_none.return_value = existing
        payload = AnnotationUpdate(
            label_id=1, comment=None, geometry_wkt=None, is_authoritative=None
        )

        with pytest.raises(HTTPException) as exc:
            update_annotation(db, 5, payload, uuid4(), campaign=campaign)

        assert exc.value.status_code == 403

    def test_update_annotation_allowed_for_member(self):
        campaign = _campaign(LabellingPolicy(explore=PolicyAudience(kinds=["members"])))
        db = _db(cu=_MEMBER)
        user_id = uuid4()
        existing = MagicMock()
        existing.created_by_user_id = user_id
        db.execute.return_value.scalar_one_or_none.return_value = existing
        payload = AnnotationUpdate(
            label_id=1, comment=None, geometry_wkt=None, is_authoritative=None
        )

        update_annotation(db, 5, payload, user_id, campaign=campaign)

        assert existing.label_id == 1

    def test_update_annotation_skips_policy_check_when_campaign_not_passed(self):
        """No campaign -> policy can't be evaluated; defensive callers that
        don't pass one (none exist today) get the pre-policy behavior."""
        db = _db(cu=None)  # would be denied if the explore check ran
        existing = MagicMock()
        existing.created_by_user_id = uuid4()
        db.execute.return_value.scalar_one_or_none.return_value = existing
        payload = AnnotationUpdate(
            label_id=2, comment=None, geometry_wkt=None, is_authoritative=None
        )

        update_annotation(db, 5, payload, uuid4())

        assert existing.label_id == 2


class TestTaskAnnotateAxisEnforcement:
    """The task-annotate endpoint gates on assigned_tasks/unassigned_tasks,
    selected by whether the task has ANY assignment."""

    @staticmethod
    def _task(assignments=None):
        return SimpleNamespace(id=1, campaign_id=1, geometry_id=10, assignments=assignments or [])

    def test_unassigned_task_denied_when_axis_is_no_one(self):
        campaign = _campaign(LabellingPolicy(unassigned_tasks=PolicyAudience(kinds=[])))
        db = _db(cu=_MEMBER)
        db.get.return_value = campaign
        payload = AnnotationFromTaskCreate(label_id=1, comment=None, confidence=None)

        with pytest.raises(HTTPException) as exc:
            add_annotation_for_task(db, self._task(assignments=[]), payload, uuid4())

        assert exc.value.status_code == 403
        assert "unassigned" in exc.value.detail
        db.add.assert_not_called()

    def test_unassigned_task_allowed_for_member(self):
        campaign = _campaign(LabellingPolicy(unassigned_tasks=PolicyAudience(kinds=["members"])))
        db = _db(cu=_MEMBER)
        db.get.return_value = campaign
        payload = AnnotationFromTaskCreate(label_id=1, comment=None, confidence=None)

        add_annotation_for_task(db, self._task(assignments=[]), payload, uuid4())

        db.add.assert_called_once()

    def test_assigned_task_denied_when_assigned_tasks_axis_is_no_one(self):
        policy = LabellingPolicy(
            unassigned_tasks=PolicyAudience(kinds=["members"]),
            assigned_tasks=PolicyAudience(kinds=[]),
        )
        campaign = _campaign(policy)
        db = _db(cu=_MEMBER)
        db.get.return_value = campaign
        assignee_id = uuid4()
        task = self._task(assignments=[SimpleNamespace(user_id=assignee_id)])
        payload = AnnotationFromTaskCreate(label_id=1, comment=None, confidence=None)

        with pytest.raises(HTTPException) as exc:
            add_annotation_for_task(db, task, payload, assignee_id)

        assert exc.value.status_code == 403
        assert "assigned" in exc.value.detail
        db.add.assert_not_called()

    def test_assigned_task_allowed_for_assignee(self):
        policy = LabellingPolicy(assigned_tasks=PolicyAudience(kinds=["assignees"]))
        campaign = _campaign(policy)
        db = _db(cu=None)  # not a campaign member row, just an assignee
        db.get.return_value = campaign
        assignee_id = uuid4()
        task = self._task(assignments=[SimpleNamespace(user_id=assignee_id)])
        payload = AnnotationFromTaskCreate(label_id=1, comment=None, confidence=None)

        add_annotation_for_task(db, task, payload, assignee_id)

        db.add.assert_called_once()

    def test_assigned_task_denies_non_assignee_when_axis_is_assignees_only(self):
        policy = LabellingPolicy(assigned_tasks=PolicyAudience(kinds=["assignees"]))
        campaign = _campaign(policy)
        db = _db(cu=None)
        db.get.return_value = campaign
        task = self._task(assignments=[SimpleNamespace(user_id=uuid4())])
        payload = AnnotationFromTaskCreate(label_id=1, comment=None, confidence=None)

        with pytest.raises(HTTPException) as exc:
            add_annotation_for_task(db, task, payload, uuid4())

        assert exc.value.status_code == 403

    def test_created_annotation_carries_counts_toward_completion(self):
        campaign = _campaign(LabellingPolicy(unassigned_tasks=PolicyAudience(kinds=["members"])))
        db = _db(cu=_MEMBER)
        db.get.return_value = campaign
        payload = AnnotationFromTaskCreate(label_id=1, comment=None, confidence=None)

        result = add_annotation_for_task(db, self._task(assignments=[]), payload, uuid4())

        assert result.counts_toward_completion is True

    def test_assigned_task_extra_label_allowed_but_not_counting(self):
        """assigned_tasks (gating) and complete_assigned (counting) are
        different axes: a member may be allowed to add an extra label on an
        assigned task without their label counting toward completion."""
        policy = LabellingPolicy(
            assigned_tasks=PolicyAudience(kinds=["members"]),
            complete_assigned=PolicyAudience(kinds=["admins"]),
        )
        campaign = _campaign(policy)
        db = _db(cu=_MEMBER)
        db.get.return_value = campaign
        task = self._task(assignments=[SimpleNamespace(user_id=uuid4())])
        payload = AnnotationFromTaskCreate(label_id=1, comment=None, confidence=None)

        result = add_annotation_for_task(db, task, payload, uuid4())

        assert result is not None
        assert result.counts_toward_completion is False


class TestAttachCountsTowardCompletion:
    """Bulk role-map-based attachment used by task-list/export endpoints."""

    def test_task_tree_shape_computes_per_annotation_per_task(self):
        admin_id, member_id = uuid4(), uuid4()
        policy = LabellingPolicy(
            unassigned_tasks=PolicyAudience(kinds=["members"]),
            complete_assigned=PolicyAudience(kinds=["admins"]),
        )
        campaign = _campaign(policy)

        assigned_task = SimpleNamespace(
            id=1,
            assignments=[SimpleNamespace(user_id=admin_id)],
            annotations=[
                SimpleNamespace(created_by_user_id=admin_id),
                SimpleNamespace(created_by_user_id=member_id),
            ],
        )
        unassigned_task = SimpleNamespace(
            id=2,
            assignments=[],
            annotations=[SimpleNamespace(created_by_user_id=member_id)],
        )

        db = MagicMock()
        db.execute.return_value.all.return_value = [
            (admin_id, True, False),
            (member_id, False, False),
        ]
        db.scalars.return_value.all.return_value = []  # no extra platform admins

        _attach_counts_toward_completion(db, campaign, [assigned_task, unassigned_task])

        assert (
            assigned_task.annotations[0].counts_toward_completion is True
        )  # admin, complete_assigned=admins
        assert (
            assigned_task.annotations[1].counts_toward_completion is False
        )  # member, not in complete_assigned
        assert (
            unassigned_task.annotations[0].counts_toward_completion is True
        )  # member, unassigned_tasks=members

    def test_no_tasks_is_a_noop(self):
        db = MagicMock()
        _attach_counts_toward_completion(db, _campaign(LabellingPolicy()), [])
        db.execute.assert_not_called()
        db.scalars.assert_not_called()

    def test_flat_shape_leaves_standalone_annotations_untouched(self):
        campaign = _campaign(LabellingPolicy())
        standalone = SimpleNamespace(
            annotation_task_id=None, annotation_task=None, created_by_user_id=uuid4()
        )
        db = MagicMock()

        attach_counts_toward_completion_flat(db, campaign, [standalone])

        assert not hasattr(standalone, "counts_toward_completion")
        db.execute.assert_not_called()
        db.scalars.assert_not_called()

    def test_flat_shape_computes_for_task_linked_annotation(self):
        member_id = uuid4()
        campaign = _campaign(LabellingPolicy(unassigned_tasks=PolicyAudience(kinds=["members"])))
        task = SimpleNamespace(assignments=[])
        ann = SimpleNamespace(
            annotation_task_id=7, annotation_task=task, created_by_user_id=member_id
        )
        db = MagicMock()
        db.execute.return_value.all.return_value = [(member_id, False, False)]
        db.scalars.return_value.all.return_value = []

        attach_counts_toward_completion_flat(db, campaign, [ann])

        assert ann.counts_toward_completion is True
