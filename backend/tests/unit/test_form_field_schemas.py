"""Field-definition schema tests. DB-free: plain Pydantic model construction."""

import pytest
from pydantic import TypeAdapter, ValidationError

from src.campaigns.form_fields import (
    FormField,
    form_field_slug,
    validate_form_fields,
)

FIELD_ADAPTER: TypeAdapter[FormField] = TypeAdapter(FormField)


def _select(**overrides) -> dict:
    base = {
        "id": 1,
        "title": "Crop type",
        "type": "select",
        "options": [{"id": 1, "name": "Maize"}, {"id": 2, "name": "Wheat"}],
    }
    return {**base, **overrides}


class TestFieldParsing:
    def test_select_parses_with_defaults(self):
        field = FIELD_ADAPTER.validate_python(_select())
        assert field.required is False
        assert field.description is None
        assert [o.name for o in field.options] == ["Maize", "Wheat"]

    def test_multiselect_shares_select_shape(self):
        field = FIELD_ADAPTER.validate_python(_select(type="multiselect"))
        assert field.type == "multiselect"

    def test_select_requires_options(self):
        with pytest.raises(ValidationError):
            FIELD_ADAPTER.validate_python(_select(options=[]))

    def test_select_rejects_duplicate_option_ids(self):
        with pytest.raises(ValidationError):
            FIELD_ADAPTER.validate_python(
                _select(options=[{"id": 1, "name": "A"}, {"id": 1, "name": "B"}])
            )

    def test_number_field_bounds(self):
        field = FIELD_ADAPTER.validate_python(
            {"id": 2, "title": "Yield", "type": "number", "min": 0, "max": 10, "slider": True}
        )
        assert field.number_type == "float"

    def test_number_slider_requires_bounds(self):
        with pytest.raises(ValidationError):
            FIELD_ADAPTER.validate_python(
                {"id": 2, "title": "Yield", "type": "number", "slider": True}
            )

    def test_number_min_above_max_rejected(self):
        with pytest.raises(ValidationError):
            FIELD_ADAPTER.validate_python(
                {"id": 2, "title": "Yield", "type": "number", "min": 5, "max": 1}
            )

    def test_text_and_date_fields_parse(self):
        text = FIELD_ADAPTER.validate_python({"id": 3, "title": "Notes", "type": "text"})
        assert text.multiline is False
        date = FIELD_ADAPTER.validate_python({"id": 4, "title": "Planted", "type": "date"})
        assert date.type == "date"

    def test_blank_title_rejected(self):
        with pytest.raises(ValidationError):
            FIELD_ADAPTER.validate_python(_select(title="  "))

    def test_unknown_type_rejected(self):
        with pytest.raises(ValidationError):
            FIELD_ADAPTER.validate_python(_select(type="checkbox"))


class TestSlugAndListValidation:
    def test_slug_normalizes(self):
        assert form_field_slug("Crop Type (2026)!") == "crop_type_2026"

    def test_duplicate_ids_rejected(self):
        fields = [
            FIELD_ADAPTER.validate_python(_select()),
            FIELD_ADAPTER.validate_python(_select(title="Other")),
        ]
        with pytest.raises(ValueError, match="field id"):
            validate_form_fields(fields)

    def test_duplicate_slugs_rejected(self):
        fields = [
            FIELD_ADAPTER.validate_python(_select()),
            FIELD_ADAPTER.validate_python(_select(id=2, title="crop-type")),
        ]
        with pytest.raises(ValueError, match="slug"):
            validate_form_fields(fields)

    def test_distinct_fields_pass(self):
        fields = [
            FIELD_ADAPTER.validate_python(_select()),
            FIELD_ADAPTER.validate_python(_select(id=2, title="Land use")),
        ]
        validate_form_fields(fields)
