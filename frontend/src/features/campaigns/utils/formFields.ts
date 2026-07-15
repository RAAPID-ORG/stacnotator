import type { CampaignSettingsCreate } from '~/api/client';

export type FormField = NonNullable<CampaignSettingsCreate['form_fields']>[number];

// Mirrors backend/src/campaigns/form_fields.py::form_field_slug - keep in sync.
export function formFieldSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function fieldLabel(field: FormField): string {
  return field.title.trim() || `field ${field.id}`;
}

// Mirrors backend/src/campaigns/form_fields.py limits - keep in sync.
const MAX_TITLE_LENGTH = 200;
const MAX_DESCRIPTION_LENGTH = 2000;
const MAX_OPTION_NAME_LENGTH = 200;
export const MAX_FIELDS = 100;
export const MAX_OPTIONS = 200;

// Mirrors backend/src/campaigns/form_fields.py validators - keep in sync.
export function validateFormFields(fields: FormField[]): string[] {
  const errors: string[] = [];

  if (fields.length > MAX_FIELDS) {
    errors.push(`A form may not have more than ${MAX_FIELDS} fields.`);
  }

  for (const field of fields) {
    if (!field.title.trim()) {
      errors.push(`Field ${field.id} needs a title.`);
    } else if (field.title.trim().length > MAX_TITLE_LENGTH) {
      errors.push(`"${fieldLabel(field)}" title must not exceed ${MAX_TITLE_LENGTH} characters.`);
    }
    if ((field.description ?? '').length > MAX_DESCRIPTION_LENGTH) {
      errors.push(
        `"${fieldLabel(field)}" description must not exceed ${MAX_DESCRIPTION_LENGTH} characters.`
      );
    }
  }

  const ids = fields.map((f) => f.id);
  if (new Set(ids).size !== ids.length) {
    errors.push('Field ids must be unique.');
  }

  const slugs = fields.map((f) => formFieldSlug(f.title));
  if (new Set(slugs).size !== slugs.length) {
    errors.push('Field titles must be unique.');
  }

  for (const field of fields) {
    if (field.type === 'category' || field.type === 'multicategory') {
      if (field.options.length === 0) {
        errors.push(`"${fieldLabel(field)}" needs at least one option.`);
      } else if (field.options.some((o) => !o.name.trim())) {
        errors.push(`"${fieldLabel(field)}" has an option with no name.`);
      }
      if (field.options.length > MAX_OPTIONS) {
        errors.push(`"${fieldLabel(field)}" may not have more than ${MAX_OPTIONS} options.`);
      }
      if (field.options.some((o) => o.name.length > MAX_OPTION_NAME_LENGTH)) {
        errors.push(
          `"${fieldLabel(field)}" has an option name longer than ${MAX_OPTION_NAME_LENGTH} characters.`
        );
      }
      const optionIds = field.options.map((o) => o.id);
      if (new Set(optionIds).size !== optionIds.length) {
        errors.push(`"${fieldLabel(field)}" has duplicate option ids.`);
      }
    }

    if (field.type === 'number') {
      if (field.min != null && field.max != null && field.min > field.max) {
        errors.push(`"${fieldLabel(field)}" has a min greater than its max.`);
      }
      if (field.slider && (field.min == null || field.max == null)) {
        errors.push(`"${fieldLabel(field)}" needs both min and max to render as a slider.`);
      }
    }
  }

  return errors;
}

export function formFieldsAreValid(fields: FormField[]): boolean {
  return validateFormFields(fields).length === 0;
}
