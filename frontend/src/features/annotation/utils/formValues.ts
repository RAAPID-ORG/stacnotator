import type { CampaignSettingsOut, DateRangeValue } from '~/api/client';

export type FormField = NonNullable<CampaignSettingsOut['form_fields']>[number];
export type FormValue = number | string | Array<number> | DateRangeValue;
export type FormValues = Record<string, FormValue>;

function isEmptyValue(value: FormValue | null): boolean {
  if (value == null) return true;
  if (typeof value === 'string') return value === '';
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

export function setFieldValue(
  values: FormValues,
  fieldId: number,
  value: FormValue | null
): FormValues {
  const key = String(fieldId);
  const next = { ...values };
  delete next[key];
  if (value !== null && !isEmptyValue(value)) {
    next[key] = value;
  }
  return next;
}

export function toggleMultiOption(
  values: FormValues,
  field: FormField,
  optionId: number
): FormValues {
  const key = String(field.id);
  const current = values[key];
  const selected = Array.isArray(current) ? current : [];
  const next = selected.includes(optionId)
    ? selected.filter((id) => id !== optionId)
    : [...selected, optionId].sort((a, b) => a - b);
  return setFieldValue(values, field.id, next);
}

/** Selecting an option on a select field toggles it off if already chosen; multiselect adds/removes it. */
export function applySelectOption(
  values: FormValues,
  field: FormField,
  optionId: number
): FormValues {
  if (field.type === 'multiselect') return toggleMultiOption(values, field, optionId);
  const current = values[String(field.id)];
  return setFieldValue(values, field.id, current === optionId ? null : optionId);
}

export function missingRequiredFields(fields: FormField[], values: FormValues): FormField[] {
  return fields.filter((field) => field.required && isEmptyValue(values[String(field.id)] ?? null));
}

export function formatMissingFieldsTitle(missing: FormField[]): string {
  return `Missing required: ${missing.map((field) => field.title).join(', ')}`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isDateRangeValue(value: unknown): value is DateRangeValue {
  return isPlainObject(value) && typeof value.start === 'string' && typeof value.end === 'string';
}

function isFormValue(value: unknown): value is FormValue {
  if (typeof value === 'number' || typeof value === 'string') return true;
  if (Array.isArray(value)) return value.every((item) => typeof item === 'number');
  return isDateRangeValue(value);
}

function isFormValues(raw: unknown): raw is FormValues {
  return isPlainObject(raw) && Object.values(raw).every(isFormValue);
}

export function hydrateFormValues(raw: unknown): FormValues {
  return isFormValues(raw) ? raw : {};
}
