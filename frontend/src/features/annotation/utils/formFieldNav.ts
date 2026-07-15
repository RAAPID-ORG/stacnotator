import type { FormField, FormValues } from './formValues';
import { applyCategoryOption } from './formValues';

// activeIndex convention: null = no field focused (digits select labels, task mode)
// LABEL_FIELD_INDEX = the primary label selector focused (digits still select labels)
// 0..fields.length-1 = custom field focused.
export const LABEL_FIELD_INDEX = -1;

// Cycle order: LABEL_FIELD_INDEX -> 0 -> ... -> fieldCount-1 -> LABEL_FIELD_INDEX
// (reversed for direction -1), wrapping directly between the label slot and
// the last field with no "nothing selected" stop in between. `current ===
// null` only occurs on entry (nothing focused yet, e.g. after Escape). On
// entry the label selector is already the active digit target (null and
// LABEL_FIELD_INDEX both route digits to labels; the only difference is the
// focus ring), so entering forward skips straight to the first custom field
// rather than re-highlighting a slot that is already active - the label slot
// is still reached by wrapping past the last field, and by Shift+Tab. Entering
// reverse goes to the last field for the same reason. fieldCount 0 always
// stays null so zero-field campaigns are unaffected - callers gate Tab
// handling on fieldCount > 0.
export function cycleFieldIndex(
  current: number | null,
  fieldCount: number,
  direction: 1 | -1
): number | null {
  if (fieldCount === 0) return null;
  if (direction === 1) {
    if (current === null) return 0;
    if (current === LABEL_FIELD_INDEX) return 0;
    return current === fieldCount - 1 ? LABEL_FIELD_INDEX : current + 1;
  }
  if (current === null) return fieldCount - 1;
  if (current === 0) return LABEL_FIELD_INDEX;
  if (current === LABEL_FIELD_INDEX) return fieldCount - 1;
  return current - 1;
}

export function digitTargetsOption(field: FormField): boolean {
  return field.type === 'category' || field.type === 'multicategory';
}

export function optionIdForDigit(field: FormField, digit: number): number | null {
  if (!digitTargetsOption(field) || !('options' in field)) return null;
  const option = field.options[digit - 1];
  return option ? option.id : null;
}

// What a digit keypress does to the currently-active field: toggle one of
// its options, focus its input for typing, or nothing (digit out of range).
export type FieldDigitAction =
  | { kind: 'toggleOption'; optionId: number }
  | { kind: 'focusInput' }
  | { kind: 'none' };

export function fieldDigitAction(field: FormField, digit: number): FieldDigitAction {
  if (!digitTargetsOption(field)) return { kind: 'focusInput' };
  const optionId = optionIdForDigit(field, digit);
  return optionId === null ? { kind: 'none' } : { kind: 'toggleOption', optionId };
}

/** Focuses the first input/textarea inside a field's container, per AnnotationForm's data-form-field-id. */
export function focusFormFieldInput(fieldId: number): void {
  const input = document.querySelector<HTMLElement>(
    `[data-form-field-id="${fieldId}"] input, [data-form-field-id="${fieldId}"] textarea`
  );
  input?.focus();
}

/** Digit pressed while `field` is the active custom form field: toggles an
 * option or focuses the field's input, per `fieldDigitAction`. Shared by the
 * task-mode and open-mode keyboard hooks so the dispatch logic lives once. */
export function applyFieldDigit(
  field: FormField,
  digitKey: string,
  values: FormValues,
  setValues: (next: FormValues) => void
): void {
  const action = fieldDigitAction(field, parseInt(digitKey, 10));
  if (action.kind === 'toggleOption') {
    setValues(applyCategoryOption(values, field, action.optionId));
  } else if (action.kind === 'focusInput') {
    focusFormFieldInput(field.id);
  }
}
