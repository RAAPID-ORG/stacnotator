import type { FormField } from '~/features/annotation/core/apiTypes';
import { missingRequiredFields, type FormValues } from './formValues';

export interface FormValidation {
  ok: boolean;
  /** Titles of the required fields left unanswered, in field order. */
  missing: string[];
}

export function validateForm(fields: FormField[], values: Record<string, unknown>): FormValidation {
  const missing = missingRequiredFields(fields, values as FormValues);
  return { ok: missing.length === 0, missing: missing.map((field) => field.title) };
}
