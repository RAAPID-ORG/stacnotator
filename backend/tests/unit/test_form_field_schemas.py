"""Field-definition schema tests. DB-free: plain Pydantic model construction."""

import pytest
from pydantic import TypeAdapter, ValidationError

from src.campaigns.form_fields import (
    FormField,
    form_field_slug,
    validate_form_fields,
)

FIELD_ADAPTER: TypeAdapter[FormField] = TypeAdapter(FormField)


def _category(**overrides) -> dict:
    base = {
        "id": 1,
        "title": "Crop type",
        "type": "category",
        "options": [{"id": 1, "name": "Maize"}, {"id": 2, "name": "Wheat"}],
    }
    return {**base, **overrides}


class TestFieldParsing:
    def test_category_parses_with_defaults(self):
        field = FIELD_ADAPTER.validate_python(_category())
        assert field.required is False
        assert field.description is None
        assert [o.name for o in field.options] == ["Maize", "Wheat"]

    def test_multicategory_shares_category_shape(self):
        field = FIELD_ADAPTER.validate_python(_category(type="multicategory"))
        assert field.type == "multicategory"

    def test_category_requires_options(self):
        with pytest.raises(ValidationError):
            FIELD_ADAPTER.validate_python(_category(options=[]))

    def test_category_rejects_duplicate_option_ids(self):
        with pytest.raises(ValidationError):
            FIELD_ADAPTER.validate_python(
                _category(options=[{"id": 1, "name": "A"}, {"id": 1, "name": "B"}])
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
            FIELD_ADAPTER.validate_python(_category(title="  "))

    def test_unknown_type_rejected(self):
        with pytest.raises(ValidationError):
            FIELD_ADAPTER.validate_python(_category(type="checkbox"))


class TestSlugAndListValidation:
    def test_slug_normalizes(self):
        assert form_field_slug("Crop Type (2026)!") == "crop_type_2026"

    def test_duplicate_ids_rejected(self):
        fields = [
            FIELD_ADAPTER.validate_python(_category()),
            FIELD_ADAPTER.validate_python(_category(title="Other")),
        ]
        with pytest.raises(ValueError, match="field id"):
            validate_form_fields(fields)

    def test_duplicate_slugs_rejected(self):
        fields = [
            FIELD_ADAPTER.validate_python(_category()),
            FIELD_ADAPTER.validate_python(_category(id=2, title="crop-type")),
        ]
        with pytest.raises(ValueError, match="slug"):
            validate_form_fields(fields)

    def test_distinct_fields_pass(self):
        fields = [
            FIELD_ADAPTER.validate_python(_category()),
            FIELD_ADAPTER.validate_python(_category(id=2, title="Land use")),
        ]
        validate_form_fields(fields)
