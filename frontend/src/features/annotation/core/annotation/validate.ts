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

export interface SubmitReadiness {
  selectedLabelId: number | null;
  /** Whether this user already has a label on the task. */
  hasExistingLabel: boolean;
  mayLabel: boolean;
  isSubmitting: boolean;
}

/** Submitting with nothing selected means "take my label off this task", which
 *  only exists when there is one to take off. */
export function isRemovingLabel(
  state: Pick<SubmitReadiness, 'selectedLabelId' | 'hasExistingLabel'>
): boolean {
  return state.hasExistingLabel && state.selectedLabelId === null;
}

/** The single predicate behind both the Submit button's enabled state and the
 *  Enter hotkey: a keystroke must never record what the button refuses. An
 *  empty submission is a skip, and skipping has its own assignee check and
 *  confirmation. */
export function maySubmitTask(state: SubmitReadiness): boolean {
  if (state.isSubmitting || !state.mayLabel) return false;
  return state.selectedLabelId !== null || isRemovingLabel(state);
}
