"""Validation and normalization of submitted form values.

Functional core: no DB, no HTTP. Callers translate FormValidationError
into a 400 response.
"""

import math
from datetime import date

from src.campaigns.form_fields import (
    CategoryFormField,
    DateFormField,
    FormField,
    NumberFormField,
    TextFormField,
)


class FormValidationError(ValueError):
    def __init__(self, message: str):
        super().__init__(message)
        self.message = message


def _parse_iso_date(raw: object, field_title: str) -> str:
    if not isinstance(raw, str):
        raise FormValidationError(f"'{field_title}' expects an ISO date string")
    try:
        return date.fromisoformat(raw).isoformat()
    except ValueError as exc:
        raise FormValidationError(f"'{field_title}' has an invalid date: {raw}") from exc


def _validate_number(field: NumberFormField, raw: object) -> int | float | None:
    if isinstance(raw, bool) or not isinstance(raw, int | float):
        raise FormValidationError(f"'{field.title}' expects a number")
    if not math.isfinite(raw):
        raise FormValidationError(f"'{field.title}' must be a finite number")
    if field.number_type == "int":
        if isinstance(raw, float):
            if not raw.is_integer():
                raise FormValidationError(f"'{field.title}' expects an integer")
            raw = int(raw)
    else:
        raw = float(raw)
    if (field.min is not None and raw < field.min) or (field.max is not None and raw > field.max):
        raise FormValidationError(f"'{field.title}' is out of range")
    return raw


def _validate_category(field: CategoryFormField, raw: object) -> int | list[int] | None:
    option_ids = {option.id for option in field.options}
    if field.type == "category":
        if isinstance(raw, bool) or not isinstance(raw, int):
            raise FormValidationError(f"'{field.title}' expects an option id")
        if raw not in option_ids:
            raise FormValidationError(f"'{field.title}' has an unknown option: {raw}")
        return raw
    if not isinstance(raw, list) or any(isinstance(v, bool) or not isinstance(v, int) for v in raw):
        raise FormValidationError(f"'{field.title}' expects a list of option ids")
    if len(raw) != len(set(raw)):
        raise FormValidationError(f"'{field.title}' contains duplicate options")
    unknown = [v for v in raw if v not in option_ids]
    if unknown:
        raise FormValidationError(f"'{field.title}' has unknown options: {unknown}")
    return sorted(raw) if raw else None


def _validate_one(field: FormField, raw: object) -> object | None:
    if isinstance(field, CategoryFormField):
        return _validate_category(field, raw)
    if isinstance(field, NumberFormField):
        return _validate_number(field, raw)
    if isinstance(field, TextFormField):
        if not isinstance(raw, str):
            raise FormValidationError(f"'{field.title}' expects text")
        stripped = raw.strip()
        max_length = 5000 if field.multiline else 500
        if len(stripped) > max_length:
            raise FormValidationError(f"'{field.title}' is too long (max {max_length} characters)")
        return stripped or None
    if isinstance(field, DateFormField) and field.type == "date":
        return _parse_iso_date(raw, field.title)
    if not isinstance(raw, dict) or set(raw) != {"start", "end"}:
        raise FormValidationError(f"'{field.title}' expects {{start, end}}")
    start = _parse_iso_date(raw["start"], field.title)
    end = _parse_iso_date(raw["end"], field.title)
    if start > end:
        raise FormValidationError(f"'{field.title}' start must not be after end")
    return {"start": start, "end": end}


def validate_form_values(
    fields: list[FormField], form_values: dict | None, *, enforce_required: bool
) -> dict | None:
    if form_values is not None and not isinstance(form_values, dict):
        raise FormValidationError("form values must be an object")
    fields_by_key = {str(field.id): field for field in fields}
    normalized: dict = {}
    for key, raw in (form_values or {}).items():
        field = fields_by_key.get(str(key))
        if field is None:
            raise FormValidationError(f"unknown form field id: {key}")
        if raw is None:
            continue
        value = _validate_one(field, raw)
        if value is not None:
            normalized[str(key)] = value
    if enforce_required:
        missing = [
            field.title for field in fields if field.required and str(field.id) not in normalized
        ]
        if missing:
            raise FormValidationError(f"required form fields missing: {', '.join(missing)}")
    return normalized or None
