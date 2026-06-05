"""Tests for annotation task status computation logic."""

from uuid import uuid4

from geoalchemy2.elements import WKTElement

from src.annotation.schemas import AnnotationTaskOut, compute_task_status_value


def _make_assignment(user_id, status="pending"):
    return {"user_id": user_id, "status": status}


def _make_annotation(user_id, label_id, is_authoritative=False):
    return {
        "label_id": label_id,
        "created_by_user_id": user_id,
        "is_authoritative": is_authoritative,
    }


def _make_task(assignments, annotations, task_id=1):
    """Build an AnnotationTaskOut from simple assignment/annotation dicts."""
    return AnnotationTaskOut(
        id=task_id,
        annotation_number=1,
        geometry={"id": 1, "geometry": WKTElement("POINT(0 0)", srid=4326)},
        assignments=assignments,
        annotations=[
            {
                "id": i,
                "comment": None,
                "created_at": "2025-01-01T00:00:00",
                "updated_at": "2025-01-01T00:00:00",
                "confidence": None,
                "is_authoritative": False,
                "flagged_for_review": False,
                "flag_comment": None,
                # Spread last so caller-provided values (e.g. is_authoritative) win.
                **a,
            }
            for i, a in enumerate(annotations, start=1)
        ],
    )


class TestTaskStatusComputation:
    def test_no_assignments_no_annotations_is_pending(self):
        task = _make_task(assignments=[], annotations=[])
        assert task.task_status == "pending"

    def test_no_assignments_with_annotation_is_done(self):
        uid = uuid4()
        task = _make_task(
            assignments=[],
            annotations=[_make_annotation(uid, label_id=1)],
        )
        assert task.task_status == "done"

    def test_all_skipped_is_skipped(self):
        u1, u2 = uuid4(), uuid4()
        task = _make_task(
            assignments=[
                _make_assignment(u1, "skipped"),
                _make_assignment(u2, "skipped"),
            ],
            annotations=[],
        )
        assert task.task_status == "skipped"

    def test_pending_when_no_completions(self):
        u1 = uuid4()
        task = _make_task(
            assignments=[_make_assignment(u1, "pending")],
            annotations=[],
        )
        assert task.task_status == "pending"

    def test_partial_when_some_completed(self):
        u1, u2 = uuid4(), uuid4()
        task = _make_task(
            assignments=[
                _make_assignment(u1, "done"),
                _make_assignment(u2, "pending"),
            ],
            annotations=[_make_annotation(u1, label_id=1)],
        )
        assert task.task_status == "partial"

    def test_done_when_all_agree(self):
        u1, u2 = uuid4(), uuid4()
        task = _make_task(
            assignments=[
                _make_assignment(u1, "done"),
                _make_assignment(u2, "done"),
            ],
            annotations=[
                _make_annotation(u1, label_id=1),
                _make_annotation(u2, label_id=1),
            ],
        )
        assert task.task_status == "done"

    def test_conflicting_when_different_labels(self):
        u1, u2 = uuid4(), uuid4()
        task = _make_task(
            assignments=[
                _make_assignment(u1, "done"),
                _make_assignment(u2, "done"),
            ],
            annotations=[
                _make_annotation(u1, label_id=1),
                _make_annotation(u2, label_id=2),
            ],
        )
        assert task.task_status == "conflicting"

    def test_one_label_plus_one_skip_is_partial(self):
        """A skip is not a tie-breaker - the task is not fully resolved
        until every assignee has actually labeled it."""
        u1, u2 = uuid4(), uuid4()
        task = _make_task(
            assignments=[
                _make_assignment(u1, "done"),
                _make_assignment(u2, "skipped"),
            ],
            annotations=[_make_annotation(u1, label_id=1)],
        )
        assert task.task_status == "partial"

    def test_two_labels_one_skip_is_partial(self):
        """Two annotators labeled, one skipped: partial (the skipper could
        have tie-broken a would-be conflict)."""
        u1, u2, u3 = uuid4(), uuid4(), uuid4()
        task = _make_task(
            assignments=[
                _make_assignment(u1, "done"),
                _make_assignment(u2, "done"),
                _make_assignment(u3, "skipped"),
            ],
            annotations=[
                _make_annotation(u1, label_id=1),
                _make_annotation(u2, label_id=1),
            ],
        )
        assert task.task_status == "partial"


class TestAuthoritativeOverride:
    """An authoritative reviewer's label resolves a task on its own,
    overriding the assignment-based aggregation."""

    def test_authoritative_resolves_a_conflict_to_done(self):
        """Two assignees disagree, then an authoritative reviewer labels it:
        the task is done (not conflicting)."""
        u1, u2, reviewer = uuid4(), uuid4(), uuid4()
        task = _make_task(
            assignments=[
                _make_assignment(u1, "done"),
                _make_assignment(u2, "done"),
            ],
            annotations=[
                _make_annotation(u1, label_id=1),
                _make_annotation(u2, label_id=2),
                _make_annotation(reviewer, label_id=3, is_authoritative=True),
            ],
        )
        assert task.task_status == "done"

    def test_authoritative_resolves_partial_to_done(self):
        """One assignee labeled, one still pending, plus an authoritative
        label -> done (the authoritative label short-circuits aggregation)."""
        u1, u2, reviewer = uuid4(), uuid4(), uuid4()
        task = _make_task(
            assignments=[
                _make_assignment(u1, "done"),
                _make_assignment(u2, "pending"),
            ],
            annotations=[
                _make_annotation(u1, label_id=1),
                _make_annotation(reviewer, label_id=1, is_authoritative=True),
            ],
        )
        assert task.task_status == "done"

    def test_authoritative_alone_is_done_even_with_pending_assignees(self):
        """Only the authoritative reviewer has acted; assignees untouched."""
        u1, u2, reviewer = uuid4(), uuid4(), uuid4()
        task = _make_task(
            assignments=[
                _make_assignment(u1, "pending"),
                _make_assignment(u2, "pending"),
            ],
            annotations=[
                _make_annotation(reviewer, label_id=2, is_authoritative=True),
            ],
        )
        assert task.task_status == "done"

    def test_without_authoritative_the_same_disagreement_is_conflicting(self):
        """Control: drop the authoritative flag and the task is conflicting,
        confirming it is the flag (not the extra annotation) doing the work."""
        u1, u2, u3 = uuid4(), uuid4(), uuid4()
        task = _make_task(
            assignments=[
                _make_assignment(u1, "done"),
                _make_assignment(u2, "done"),
                _make_assignment(u3, "done"),
            ],
            annotations=[
                _make_annotation(u1, label_id=1),
                _make_annotation(u2, label_id=2),
                _make_annotation(u3, label_id=3),
            ],
        )
        assert task.task_status == "conflicting"


class TestComputeTaskStatusValue:
    """The pure helper used by the CSV/GeoJSON export must match the schema path.

    The export computes status from in-memory data via ``compute_task_status_value``
    instead of ``AnnotationTaskOut.model_validate`` (which lazy-loads relationships
    per task/annotation). These assert the helper produces identical statuses.
    """

    def test_no_assignments_with_annotation_is_done(self):
        u1 = uuid4()
        assert compute_task_status_value([], [_make_annotation(u1, label_id=1)]) == "done"

    def test_no_assignments_no_annotations_is_pending(self):
        assert compute_task_status_value([], []) == "pending"

    def test_all_skipped_is_skipped(self):
        u1, u2 = uuid4(), uuid4()
        assignments = [_make_assignment(u1, "skipped"), _make_assignment(u2, "skipped")]
        assert compute_task_status_value(assignments, []) == "skipped"

    def test_partial_when_some_completed(self):
        u1, u2 = uuid4(), uuid4()
        assignments = [_make_assignment(u1, "done"), _make_assignment(u2, "pending")]
        annotations = [_make_annotation(u1, label_id=1)]
        assert compute_task_status_value(assignments, annotations) == "partial"

    def test_done_when_all_agree(self):
        u1, u2 = uuid4(), uuid4()
        assignments = [_make_assignment(u1, "done"), _make_assignment(u2, "done")]
        annotations = [_make_annotation(u1, label_id=1), _make_annotation(u2, label_id=1)]
        assert compute_task_status_value(assignments, annotations) == "done"

    def test_conflicting_when_different_labels(self):
        u1, u2 = uuid4(), uuid4()
        assignments = [_make_assignment(u1, "done"), _make_assignment(u2, "done")]
        annotations = [_make_annotation(u1, label_id=1), _make_annotation(u2, label_id=2)]
        assert compute_task_status_value(assignments, annotations) == "conflicting"

    def test_authoritative_overrides_conflict_to_done(self):
        u1, u2, u3 = uuid4(), uuid4(), uuid4()
        assignments = [_make_assignment(u1, "done"), _make_assignment(u2, "done")]
        annotations = [
            _make_annotation(u1, label_id=1),
            _make_annotation(u2, label_id=2),
            _make_annotation(u3, label_id=3, is_authoritative=True),
        ]
        assert compute_task_status_value(assignments, annotations) == "done"

    def test_matches_schema_path_for_partial(self):
        """Helper and full model_validate path agree on the same inputs."""
        u1, u2 = uuid4(), uuid4()
        assignments = [_make_assignment(u1, "done"), _make_assignment(u2, "pending")]
        annotations = [_make_annotation(u1, label_id=1)]
        via_schema = _make_task(assignments, annotations).task_status
        via_helper = compute_task_status_value(assignments, annotations)
        assert via_helper == via_schema == "partial"
