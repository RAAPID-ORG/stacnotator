"""Pure validation of submitted form values against a campaign's field definitions."""

import pytest
from pydantic import TypeAdapter

from src.annotation.forms import FormValidationError, validate_form_values
from src.campaigns.form_fields import FormField

_ADAPTER: TypeAdapter[list[FormField]] = TypeAdapter(list[FormField])

FIELDS = _ADAPTER.validate_python(
    [
        {
            "id": 1,
            "title": "Crop",
            "type": "category",
            "required": True,
            "options": [{"id": 1, "name": "Maize"}, {"id": 2, "name": "Wheat"}],
        },
        {
            "id": 2,
            "title": "Damage",
            "type": "multicategory",
            "options": [{"id": 1, "name": "Flood"}, {"id": 2, "name": "Drought"}],
        },
        {"id": 3, "title": "Yield", "type": "number", "number_type": "int", "min": 0, "max": 10},
        {"id": 4, "title": "Notes", "type": "text"},
        {"id": 5, "title": "Planted", "type": "date"},
        {"id": 6, "title": "Season", "type": "daterange"},
        {"id": 7, "title": "Long notes", "type": "text", "multiline": True},
    ]
)


def _valid_values() -> dict:
    return {
        "1": 1,
        "2": [2, 1],
        "3": 7,
        "4": "  some note ",
        "5": "2026-05-01",
        "6": {"start": "2026-05-01", "end": "2026-09-30"},
    }


class TestNormalization:
    def test_valid_payload_normalizes(self):
        result = validate_form_values(FIELDS, _valid_values(), enforce_required=True)
        assert result == {
            "1": 1,
            "2": [1, 2],
            "3": 7,
            "4": "some note",
            "5": "2026-05-01",
            "6": {"start": "2026-05-01", "end": "2026-09-30"},
        }

    def test_empty_entries_dropped(self):
        result = validate_form_values(FIELDS, {"1": 1, "2": [], "4": "   "}, enforce_required=True)
        assert result == {"1": 1}

    def test_none_and_empty_dict_pass_through(self):
        assert validate_form_values(FIELDS, None, enforce_required=False) is None
        assert validate_form_values(FIELDS, {}, enforce_required=False) is None

    def test_float_coerced_to_int_when_integral(self):
        result = validate_form_values(FIELDS, {"1": 1, "3": 7.0}, enforce_required=True)
        assert result["3"] == 7
        assert isinstance(result["3"], int)


class TestRejection:
    def test_unknown_field_id(self):
        with pytest.raises(FormValidationError, match="unknown"):
            validate_form_values(FIELDS, {"99": 1}, enforce_required=False)

    def test_category_option_not_in_field(self):
        with pytest.raises(FormValidationError, match="option"):
            validate_form_values(FIELDS, {"1": 99}, enforce_required=False)

    def test_multicategory_duplicate_options(self):
        with pytest.raises(FormValidationError, match="duplicate"):
            validate_form_values(FIELDS, {"2": [1, 1]}, enforce_required=False)

    def test_multicategory_wrong_type(self):
        with pytest.raises(FormValidationError):
            validate_form_values(FIELDS, {"2": 1}, enforce_required=False)

    def test_number_out_of_range(self):
        with pytest.raises(FormValidationError, match="range"):
            validate_form_values(FIELDS, {"3": 11}, enforce_required=False)

    def test_int_field_rejects_fractional(self):
        with pytest.raises(FormValidationError, match="integer"):
            validate_form_values(FIELDS, {"3": 6.5}, enforce_required=False)

    def test_number_rejects_bool_and_string(self):
        with pytest.raises(FormValidationError):
            validate_form_values(FIELDS, {"3": True}, enforce_required=False)
        with pytest.raises(FormValidationError):
            validate_form_values(FIELDS, {"3": "7"}, enforce_required=False)

    def test_number_rejects_nan(self):
        with pytest.raises(FormValidationError, match="finite"):
            validate_form_values(FIELDS, {"3": float("nan")}, enforce_required=False)

    def test_number_rejects_infinity(self):
        with pytest.raises(FormValidationError, match="finite"):
            validate_form_values(FIELDS, {"3": float("inf")}, enforce_required=False)
        with pytest.raises(FormValidationError, match="finite"):
            validate_form_values(FIELDS, {"3": float("-inf")}, enforce_required=False)

    def test_bad_date_format(self):
        with pytest.raises(FormValidationError, match="date"):
            validate_form_values(FIELDS, {"5": "01.05.2026"}, enforce_required=False)

    def test_daterange_start_after_end(self):
        with pytest.raises(FormValidationError, match="start"):
            validate_form_values(
                FIELDS,
                {"6": {"start": "2026-09-30", "end": "2026-05-01"}},
                enforce_required=False,
            )

    def test_missing_required_enforced(self):
        with pytest.raises(FormValidationError, match="required"):
            validate_form_values(FIELDS, {"4": "note"}, enforce_required=True)

    def test_missing_required_ignored_when_not_enforced(self):
        result = validate_form_values(FIELDS, {"4": "note"}, enforce_required=False)
        assert result == {"4": "note"}

    def test_text_cap_depends_on_multiline(self):
        # Field 4 is single-line (500), field 7 is multiline (5000). Asserting
        # both caps at their boundary is what pins the two apart: an
        # over-the-cap rejection alone would still pass if multiline wrongly
        # inherited the 500 cap.
        short = validate_form_values(FIELDS, {"4": "x" * 500}, enforce_required=False)
        multiline = validate_form_values(FIELDS, {"7": "x" * 5000}, enforce_required=False)
        assert len(short["4"]) == 500
        assert len(multiline["7"]) == 5000
        with pytest.raises(FormValidationError, match="too long"):
            validate_form_values(FIELDS, {"4": "x" * 501}, enforce_required=False)
        with pytest.raises(FormValidationError, match="too long"):
            validate_form_values(FIELDS, {"7": "x" * 5001}, enforce_required=False)
