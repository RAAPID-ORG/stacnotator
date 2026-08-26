import type { AnnotationOut, CampaignSettingsOut } from '~/api/client';

export type FormField = NonNullable<CampaignSettingsOut['form_fields']>[number];
export type FormValues = NonNullable<AnnotationOut['form_values']>;
export type FormValue = FormValues[string];

/** A daterange answer, the one value shape that is not a scalar or id list. */
export function isDateRangeValue(value: unknown): value is { start: string; end: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as { start?: unknown }).start === 'string' &&
    typeof (value as { end?: unknown }).end === 'string'
  );
}

/**
 * One stored answer as text. Mirrors the backend's export formatting
 * (annotation/export.py format_form_value) so a review table, a CSV and a
 * GeoJSON all name an option the same way. Null means unanswered.
 *
 * Unlike the backend this never raises on a shape mismatch: a table showing a
 * stale answer is better than one that refuses to render at all.
 */
export function formatFormValue(
  field: FormField,
  value: FormValue | null | undefined
): string | null {
  if (value === null || value === undefined || value === '') return null;

  if (field.type === 'category' || field.type === 'multicategory') {
    const names = new Map(field.options.map((option) => [option.id, option.name]));
    const ids = Array.isArray(value) ? value : [value];
    if (ids.length === 0) return null;
    return ids.map((id) => names.get(Number(id)) ?? String(id)).join('; ');
  }

  if (isDateRangeValue(value)) return `${value.start}/${value.end}`;
  return String(value);
}

/** Every answered field of a campaign, in the order the form defines them. */
export function answeredFields(
  fields: FormField[],
  values: FormValues | null | undefined
): { field: FormField; text: string }[] {
  if (!values) return [];
  return fields.flatMap((field) => {
    const text = formatFormValue(field, values[String(field.id)]);
    return text === null ? [] : [{ field, text }];
  });
}
