"""Unit tests for `validate_annotation_form_values` and its wiring into the
annotation write paths (create/bulk-create/update/task-submit).

DB-free per repo convention: campaigns/tasks are MagicMock or SimpleNamespace
stand-ins, and the DB session is a MagicMock (mirrors
test_labelling_policy_enforcement.py).
"""

from types import SimpleNamespace
from unittest.mock import MagicMock
from uuid import uuid4

import pytest
from fastapi import HTTPException

from src.annotation.schemas import AnnotationCreate, AnnotationFromTaskCreate, AnnotationUpdate
from src.annotation.service import (
    add_annotation_for_task,
    create_annotation,
    create_annotations_bulk,
    update_annotation,
    validate_annotation_form_values,
)

REQUIRED_CATEGORY_FIELD = [
    {
        "id": 1,
        "title": "Crop",
        "type": "category",
        "required": True,
        "options": [{"id": 1, "name": "Maize"}, {"id": 2, "name": "Wheat"}],
    },
]


def _campaign(form_fields=None, *, campaign_id=1, is_public=False):
    campaign = MagicMock()
    campaign.id = campaign_id
    campaign.is_public = is_public
    campaign.settings.labels = {"1": {"name": "Forest"}, "2": {"name": "Water"}}
    campaign.settings.labelling_policy = None
    campaign.settings.form_fields = form_fields if form_fields is not None else []
    return campaign


def _db(cu=None):
    db = MagicMock()
    db.execute.return_value.scalar_one_or_none.return_value = None
    db.execute.return_value.first.return_value = None
    db.scalars.return_value.first.return_value = cu
    return db


_MEMBER = SimpleNamespace(is_admin=False, is_authorative_reviewer=False)


class TestValidateAnnotationFormValuesHelper:
    def test_happy_path_returns_normalized_dict(self):
        campaign = _campaign(REQUIRED_CATEGORY_FIELD)

        result = validate_annotation_form_values(campaign, {"1": 1}, enforce_required=True)

        assert result == {"1": 1}

    def test_form_validation_error_becomes_http_400_with_message(self):
        campaign = _campaign(REQUIRED_CATEGORY_FIELD)

        with pytest.raises(HTTPException) as exc:
            validate_annotation_form_values(campaign, {"1": 99}, enforce_required=True)

        assert exc.value.status_code == 400
        assert "unknown option" in exc.value.detail

    def test_missing_required_field_becomes_http_400(self):
        campaign = _campaign(REQUIRED_CATEGORY_FIELD)

        with pytest.raises(HTTPException) as exc:
            validate_annotation_form_values(campaign, None, enforce_required=True)

        assert exc.value.status_code == 400
        assert "required" in exc.value.detail

    def test_missing_required_field_ignored_when_not_enforced(self):
        campaign = _campaign(REQUIRED_CATEGORY_FIELD)

        assert validate_annotation_form_values(campaign, None, enforce_required=False) is None

    def test_fields_are_parsed_from_campaign_settings_form_fields(self):
        # A different campaign's field list rejects an option id that would
        # be valid under REQUIRED_CATEGORY_FIELD, proving the fields actually
        # come from campaign.settings.form_fields rather than being ignored.
        other_fields = [
            {
                "id": 1,
                "title": "Crop",
                "type": "category",
                "options": [{"id": 5, "name": "Rice"}],
            },
        ]
        campaign = _campaign(other_fields)

        with pytest.raises(HTTPException) as exc:
            validate_annotation_form_values(campaign, {"1": 1}, enforce_required=False)

        assert "unknown option" in exc.value.detail

    def test_empty_field_list_allows_missing_values(self):
        campaign = _campaign([])

        assert validate_annotation_form_values(campaign, None, enforce_required=True) is None

    def test_none_form_fields_on_campaign_treated_as_empty(self):
        campaign = _campaign()
        campaign.settings.form_fields = None

        assert validate_annotation_form_values(campaign, None, enforce_required=True) is None


ALL_FIELD_TYPES = [
    {"id": 1, "title": "Crop", "type": "category", "options": [{"id": 1, "name": "Maize"}]},
    {
        "id": 2,
        "title": "Damage",
        "type": "multicategory",
        "options": [{"id": 1, "name": "Flood"}, {"id": 2, "name": "Drought"}],
    },
    {"id": 3, "title": "Yield", "type": "number", "number_type": "float"},
    {"id": 4, "title": "Notes", "type": "text"},
    {"id": 5, "title": "Planted", "type": "date"},
    {"id": 6, "title": "Season", "type": "daterange"},
]


@pytest.mark.parametrize(
    ("field_id", "submitted", "stored"),
    [
        (1, 1, 1),
        (2, [2, 1], [1, 2]),
        (3, 4.5, 4.5),
        (4, "  a note ", "a note"),
        (5, "2026-05-01", "2026-05-01"),
        (
            6,
            {"start": "2026-05-01", "end": "2026-09-30"},
            {"start": "2026-05-01", "end": "2026-09-30"},
        ),
    ],
)
def test_every_field_type_survives_schema_parsing(field_id, submitted, stored):
    # Guards the schema/validator seam: AnnotationCreate must hand
    # validate_form_values plain JSON containers. Typing a form value as a
    # BaseModel once made Pydantic coerce daterange dicts into model
    # instances, which the validator then rejected as the wrong shape.
    campaign = _campaign(ALL_FIELD_TYPES)
    db = _db(cu=_MEMBER)
    payload = AnnotationCreate(
        label_id=1,
        comment=None,
        geometry_wkt="POINT(0 0)",
        confidence=None,
        form_values={str(field_id): submitted},
    )

    annotation = create_annotation(db, campaign, payload, uuid4())

    assert annotation.form_values == {str(field_id): stored}


class TestCreateAnnotationFormValuesWiring:
    def test_persists_normalized_form_values(self):
        campaign = _campaign(REQUIRED_CATEGORY_FIELD)
        db = _db(cu=_MEMBER)
        payload = AnnotationCreate(
            label_id=1,
            comment=None,
            geometry_wkt="POINT(0 0)",
            confidence=None,
            form_values={"1": 1},
        )

        annotation = create_annotation(db, campaign, payload, uuid4())

        assert annotation.form_values == {"1": 1}

    def test_rejects_missing_required_form_value(self):
        campaign = _campaign(REQUIRED_CATEGORY_FIELD)
        db = _db(cu=_MEMBER)
        payload = AnnotationCreate(
            label_id=1, comment=None, geometry_wkt="POINT(0 0)", confidence=None
        )

        with pytest.raises(HTTPException) as exc:
            create_annotation(db, campaign, payload, uuid4())

        assert exc.value.status_code == 400
        db.add.assert_not_called()

    def test_no_form_values_ok_when_no_fields_defined(self):
        campaign = _campaign([])
        db = _db(cu=_MEMBER)
        payload = AnnotationCreate(
            label_id=1, comment=None, geometry_wkt="POINT(0 0)", confidence=None
        )

        annotation = create_annotation(db, campaign, payload, uuid4())

        assert annotation.form_values is None


class TestCreateAnnotationsBulkFormValuesWiring:
    def test_validates_each_item_and_persists(self):
        campaign = _campaign(REQUIRED_CATEGORY_FIELD)
        db = _db(cu=_MEMBER)
        payloads = [
            AnnotationCreate(
                label_id=1,
                comment=None,
                geometry_wkt="POINT(0 0)",
                confidence=None,
                form_values={"1": 1},
            ),
            AnnotationCreate(
                label_id=2,
                comment=None,
                geometry_wkt="POINT(1 1)",
                confidence=None,
                form_values={"1": 2},
            ),
        ]

        created_count = create_annotations_bulk(db, campaign, payloads, uuid4())

        assert created_count == 2
        (annotations,), _ = db.add_all.call_args_list[-1]
        assert [a.form_values for a in annotations] == [{"1": 1}, {"1": 2}]

    def test_rejects_when_any_item_missing_required_form_value(self):
        campaign = _campaign(REQUIRED_CATEGORY_FIELD)
        db = _db(cu=_MEMBER)
        payloads = [
            AnnotationCreate(
                label_id=1,
                comment=None,
                geometry_wkt="POINT(0 0)",
                confidence=None,
                form_values={"1": 1},
            ),
            AnnotationCreate(label_id=2, comment=None, geometry_wkt="POINT(1 1)", confidence=None),
        ]

        with pytest.raises(HTTPException) as exc:
            create_annotations_bulk(db, campaign, payloads, uuid4())

        assert exc.value.status_code == 400
        db.add_all.assert_not_called()


class TestUpdateAnnotationFormValuesWiring:
    def test_persists_normalized_form_values_when_label_present(self):
        campaign = _campaign(REQUIRED_CATEGORY_FIELD)
        existing = MagicMock()
        existing.label_id = 1
        existing.created_by_user_id = uuid4()
        db = _db(cu=_MEMBER)
        db.execute.return_value.scalar_one_or_none.return_value = existing
        payload = AnnotationUpdate(
            label_id=None,
            comment=None,
            geometry_wkt=None,
            is_authoritative=None,
            form_values={"1": 2},
        )

        annotation = update_annotation(db, 5, payload, uuid4(), campaign=campaign)

        assert annotation.form_values == {"1": 2}

    def test_rejects_empty_form_values_when_required_and_label_present(self):
        campaign = _campaign(REQUIRED_CATEGORY_FIELD)
        existing = MagicMock()
        existing.label_id = 1
        existing.created_by_user_id = uuid4()
        db = _db(cu=_MEMBER)
        db.execute.return_value.scalar_one_or_none.return_value = existing
        payload = AnnotationUpdate(
            label_id=None,
            comment=None,
            geometry_wkt=None,
            is_authoritative=None,
            form_values={},
        )

        with pytest.raises(HTTPException) as exc:
            update_annotation(db, 5, payload, uuid4(), campaign=campaign)

        assert exc.value.status_code == 400

    def test_form_validation_error_detail_survives_update(self):
        # A validation HTTPException raised inside the try block must reach
        # the caller with its original detail, not get swallowed by the
        # broad except and rewritten to the generic "Failed to update
        # annotation" message.
        campaign = _campaign(REQUIRED_CATEGORY_FIELD)
        existing = MagicMock()
        existing.label_id = 1
        existing.created_by_user_id = uuid4()
        db = _db(cu=_MEMBER)
        db.execute.return_value.scalar_one_or_none.return_value = existing
        payload = AnnotationUpdate(
            label_id=None,
            comment=None,
            geometry_wkt=None,
            is_authoritative=None,
            form_values={"1": 99},
        )

        with pytest.raises(HTTPException) as exc:
            update_annotation(db, 5, payload, uuid4(), campaign=campaign)

        assert exc.value.status_code == 400
        assert "Crop" in exc.value.detail
        assert exc.value.detail != "Failed to update annotation"

    def test_omitted_form_values_keeps_stored_values(self):
        campaign = _campaign(REQUIRED_CATEGORY_FIELD)
        existing = MagicMock()
        existing.label_id = 1
        existing.created_by_user_id = uuid4()
        existing.form_values = {"1": 1}
        db = _db(cu=_MEMBER)
        db.execute.return_value.scalar_one_or_none.return_value = existing
        payload = AnnotationUpdate(
            label_id=None, comment="a note", geometry_wkt=None, is_authoritative=None
        )

        annotation = update_annotation(db, 5, payload, uuid4(), campaign=campaign)

        assert annotation.form_values == {"1": 1}

    def test_adding_a_label_cannot_bypass_required_fields(self):
        # Skipped (unlabelled, no answers), then labelled via a PUT that omits
        # form_values: the required field must still be enforced rather than
        # slipping through because form_values was absent from the payload.
        campaign = _campaign(REQUIRED_CATEGORY_FIELD)
        existing = MagicMock()
        existing.label_id = None
        existing.created_by_user_id = uuid4()
        existing.form_values = None
        db = _db(cu=_MEMBER)
        db.execute.return_value.scalar_one_or_none.return_value = existing
        payload = AnnotationUpdate(
            label_id=1, comment=None, geometry_wkt=None, is_authoritative=None
        )

        with pytest.raises(HTTPException) as exc:
            update_annotation(db, 5, payload, uuid4(), campaign=campaign)

        assert exc.value.status_code == 400
        assert "Crop" in exc.value.detail

    def test_label_edit_keeps_satisfying_stored_values(self):
        campaign = _campaign(REQUIRED_CATEGORY_FIELD)
        existing = MagicMock()
        existing.label_id = None
        existing.created_by_user_id = uuid4()
        existing.form_values = {"1": 1}
        db = _db(cu=_MEMBER)
        db.execute.return_value.scalar_one_or_none.return_value = existing
        payload = AnnotationUpdate(
            label_id=1, comment=None, geometry_wkt=None, is_authoritative=None
        )

        annotation = update_annotation(db, 5, payload, uuid4(), campaign=campaign)

        assert annotation.form_values == {"1": 1}

    def test_empty_form_values_clears_when_label_absent(self):
        campaign = _campaign(REQUIRED_CATEGORY_FIELD)
        existing = MagicMock()
        existing.label_id = None
        existing.created_by_user_id = uuid4()
        existing.form_values = {"1": 1}
        db = _db(cu=_MEMBER)
        db.execute.return_value.scalar_one_or_none.return_value = existing
        payload = AnnotationUpdate(
            label_id=None,
            comment=None,
            geometry_wkt=None,
            is_authoritative=None,
            form_values={},
        )

        annotation = update_annotation(db, 5, payload, uuid4(), campaign=campaign)

        assert annotation.form_values is None


class TestAddAnnotationForTaskFormValuesWiring:
    @staticmethod
    def _task(assignments=None):
        return SimpleNamespace(id=1, campaign_id=1, geometry_id=10, assignments=assignments or [])

    def test_enforces_required_when_label_submitted(self):
        campaign = _campaign(REQUIRED_CATEGORY_FIELD)
        db = _db(cu=_MEMBER)
        db.get.return_value = campaign
        payload = AnnotationFromTaskCreate(label_id=1, comment=None)

        with pytest.raises(HTTPException) as exc:
            add_annotation_for_task(db, self._task(), payload, uuid4())

        assert exc.value.status_code == 400
        db.add.assert_not_called()

    def test_persists_normalized_form_values_on_create(self):
        campaign = _campaign(REQUIRED_CATEGORY_FIELD)
        db = _db(cu=_MEMBER)
        db.get.return_value = campaign
        payload = AnnotationFromTaskCreate(label_id=1, comment=None, form_values={"1": 1})

        annotation = add_annotation_for_task(db, self._task(), payload, uuid4())

        assert annotation is not None
        assert annotation.form_values == {"1": 1}

    def test_skip_bypasses_required_form_values(self):
        campaign = _campaign(REQUIRED_CATEGORY_FIELD)
        db = _db(cu=_MEMBER)
        db.get.return_value = campaign
        payload = AnnotationFromTaskCreate(label_id=None, comment="skipping without a label")

        annotation = add_annotation_for_task(db, self._task(), payload, uuid4())

        assert annotation is not None
        assert annotation.form_values is None
