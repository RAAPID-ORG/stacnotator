import type { AnnotationOut, CampaignSettingsOut, DateRangeValue } from '~/api/client';

export type FormField = NonNullable<CampaignSettingsOut['form_fields']>[number];
export type FormValues = NonNullable<AnnotationOut['form_values']>;
export type FormValue = FormValues[string];

function isEmptyValue(value: FormValue | null): boolean {
  if (value == null) return true;
  if (typeof value === 'string') return value.trim() === '';
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

/** Selecting an option on a category field toggles it off if already chosen; multicategory adds/removes it. */
export function applyCategoryOption(
  values: FormValues,
  field: FormField,
  optionId: number
): FormValues {
  if (field.type === 'multicategory') return toggleMultiOption(values, field, optionId);
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

export function isDateRangeValue(value: unknown): value is DateRangeValue {
  return isPlainObject(value) && typeof value.start === 'string' && typeof value.end === 'string';
}

function valueEqual(a: FormValue, b: FormValue): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    // multicategory ids are kept sorted (toggleMultiOption), so position compares.
    return (
      Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => v === b[i])
    );
  }
  if (isDateRangeValue(a) || isDateRangeValue(b)) {
    return isDateRangeValue(a) && isDateRangeValue(b) && a.start === b.start && a.end === b.end;
  }
  return a === b;
}

/** Deep-equality for two answer sets, tolerant of key order. Used to tell
 *  whether an edit actually changed anything before issuing a PATCH. */
export function formValuesEqual(a: FormValues, b: FormValues): boolean {
  const aKeys = Object.keys(a);
  if (aKeys.length !== Object.keys(b).length) return false;
  return aKeys.every((key) => key in b && valueEqual(a[key], b[key]));
}
