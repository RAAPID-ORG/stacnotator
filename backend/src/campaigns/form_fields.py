"""Field definitions for campaign custom forms.

A campaign's form is an ordered list of fields stored as JSONB on
data.settings.form_fields. The built-in label select is NOT part of this
list; it stays a separate concept (settings.labels).
"""

import re
from typing import Annotated, Literal

from pydantic import BaseModel, Field, field_validator, model_validator


class FormFieldOption(BaseModel):
    id: int
    name: str = Field(min_length=1)


class FormFieldBase(BaseModel):
    id: int
    title: str
    description: str | None = None
    required: bool = False

    @field_validator("title")
    @classmethod
    def title_not_blank(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("field title must not be blank")
        return stripped


def _validate_unique_option_ids(options: list[FormFieldOption]) -> list[FormFieldOption]:
    ids = [option.id for option in options]
    if len(ids) != len(set(ids)):
        raise ValueError("option ids must be unique")
    return options


class SelectFormField(FormFieldBase):
    type: Literal["select", "multiselect"]
    options: list[FormFieldOption] = Field(min_length=1)

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
    SelectFormField | NumberFormField | TextFormField | DateFormField,
    Field(discriminator="type"),
]


def form_field_slug(title: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", title.lower()).strip("_")


def validate_form_fields(fields: list[FormField]) -> None:
    ids = [field.id for field in fields]
    if len(ids) != len(set(ids)):
        raise ValueError("duplicate field id in form fields")
    slugs = [form_field_slug(field.title) for field in fields]
    if len(slugs) != len(set(slugs)):
        raise ValueError("duplicate field slug in form fields")
