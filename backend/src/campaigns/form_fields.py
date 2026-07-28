"""Field definitions for campaign custom forms.

A campaign's form is an ordered list of fields stored as JSONB on
data.settings.form_fields. The built-in label select is NOT part of this
list; it stays a separate concept (settings.labels).
"""

import re
from typing import Annotated, Literal

from pydantic import BaseModel, Field, StringConstraints, field_validator, model_validator

ShortName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]


class FormFieldOption(BaseModel):
    id: int
    name: ShortName


class FormFieldBase(BaseModel):
    id: int
    title: ShortName
    description: str | None = Field(default=None, max_length=2000)
    required: bool = False


def _validate_unique_option_ids(options: list[FormFieldOption]) -> list[FormFieldOption]:
    ids = [option.id for option in options]
    if len(ids) != len(set(ids)):
        raise ValueError("option ids must be unique")
    return options


class CategoryFormField(FormFieldBase):
    type: Literal["category", "multicategory"]
    options: list[FormFieldOption] = Field(min_length=1, max_length=200)

    _unique_options = field_validator("options")(_validate_unique_option_ids)


class NumberFormField(FormFieldBase):
    type: Literal["number"]
    number_type: Literal["int", "float"] = "float"
    min: float | None = None
    max: float | None = None
    step: float | None = None
    slider: bool = False

    @model_validator(mode="after")
    def check_bounds(self) -> "NumberFormField":
        if self.min is not None and self.max is not None and self.min > self.max:
            raise ValueError("min must not exceed max")
        if self.slider and (self.min is None or self.max is None):
            raise ValueError("slider rendering requires both min and max")
        return self


class TextFormField(FormFieldBase):
    type: Literal["text"]
    multiline: bool = False


class DateFormField(FormFieldBase):
    type: Literal["date", "daterange"]


FormField = Annotated[
    CategoryFormField | NumberFormField | TextFormField | DateFormField,
    Field(discriminator="type"),
]


def form_field_slug(title: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", title.lower()).strip("_")


def validate_form_fields(fields: list[FormField]) -> None:
    if len(fields) > 100:
        raise ValueError("a form may not have more than 100 fields")
    ids = [field.id for field in fields]
    if len(ids) != len(set(ids)):
        raise ValueError("duplicate field id in form fields")
    slugs = [form_field_slug(field.title) for field in fields]
    if len(slugs) != len(set(slugs)):
        raise ValueError("duplicate field slug in form fields")
