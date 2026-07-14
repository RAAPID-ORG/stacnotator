import type { FormField, FormValues } from './formValues';
import { applySelectOption } from './formValues';

// activeIndex convention: null = no field focused (digits select labels, task mode)
// 0..fields.length-1 = custom field focused.
export function cycleFieldIndex(
  current: number | null,
  fieldCount: number,
  direction: 1 | -1
): number | null {
  if (fieldCount === 0) return null;
  if (direction === 1) {
    if (current === null) return 0;
    return current === fieldCount - 1 ? null : current + 1;
  }
  if (current === null) return fieldCount - 1;
  return current === 0 ? null : current - 1;
}

export function digitTargetsOption(field: FormField): boolean {
  return field.type === 'select' || field.type === 'multiselect';
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
    setValues(applySelectOption(values, field, action.optionId));
  } else if (action.kind === 'focusInput') {
    focusFormFieldInput(field.id);
  }
}
