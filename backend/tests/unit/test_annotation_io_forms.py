"""Form-value export helpers: column naming and value formatting."""

from pydantic import TypeAdapter

from src.annotation.io import FormExportSchema, form_export_columns, format_form_value
from src.campaigns.form_fields import FormField

_ADAPTER: TypeAdapter[list[FormField]] = TypeAdapter(list[FormField])

FIELDS = _ADAPTER.validate_python(
    [
        {
            "id": 1,
            "title": "Crop Type",
            "type": "category",
            "options": [{"id": 1, "name": "Maize"}, {"id": 2, "name": "Wheat"}],
        },
        {
            "id": 2,
            "title": "Damage",
            "type": "multicategory",
            "options": [{"id": 1, "name": "Flood"}, {"id": 2, "name": "Drought"}],
        },
        {"id": 3, "title": "Yield (t/ha)", "type": "number"},
        {"id": 6, "title": "Season", "type": "daterange"},
    ]
)


def test_columns_are_slugged_and_ordered():
    assert form_export_columns(FIELDS) == [
        "stacnotator_field_crop_type",
        "stacnotator_field_damage",
        "stacnotator_field_yield_t_ha",
        "stacnotator_field_season",
    ]


def test_category_formats_to_option_name():
    assert format_form_value(FIELDS[0], 2) == "Wheat"


def test_multicategory_joins_names():
    assert format_form_value(FIELDS[1], [1, 2]) == "Flood; Drought"


def test_daterange_formats_as_interval():
    assert (
        format_form_value(FIELDS[3], {"start": "2026-05-01", "end": "2026-09-30"})
        == "2026-05-01/2026-09-30"
    )


def test_unknown_option_falls_back_to_id():
    assert format_form_value(FIELDS[0], 99) == "99"


def test_category_with_non_int_value_falls_back_to_str():
    assert format_form_value(FIELDS[0], "Wheat") == "Wheat"


def test_multicategory_with_non_list_value_falls_back_to_str():
    assert format_form_value(FIELDS[1], 1) == "1"


def test_multicategory_with_mixed_list_falls_back_to_str():
    assert format_form_value(FIELDS[1], [1, "Drought"]) == "[1, 'Drought']"


def test_daterange_with_plain_string_falls_back_to_str():
    assert format_form_value(FIELDS[3], "2026-05-01") == "2026-05-01"


def test_daterange_with_incomplete_dict_falls_back_to_str():
    assert format_form_value(FIELDS[3], {"start": "2026-05-01"}) == "{'start': '2026-05-01'}"


def test_cells_cover_all_fields_with_none_for_unanswered():
    cells = FormExportSchema(FIELDS).cells({"1": 1, "3": 4.2})
    assert cells == {
        "stacnotator_field_crop_type": "Maize",
        "stacnotator_field_damage": None,
        "stacnotator_field_yield_t_ha": 4.2,
        "stacnotator_field_season": None,
    }


def test_cells_handle_null_form_values():
    cells = FormExportSchema(FIELDS).cells(None)
    assert set(cells.values()) == {None}
