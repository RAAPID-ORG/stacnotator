import type { FormField, FormValues } from './formValues';
import { applyCategoryOption } from './formValues';

// activeIndex convention: null = no field focused (digits select labels, task mode)
// LABEL_FIELD_INDEX = the primary label selector focused (digits still select labels)
// 0..fields.length-1 = custom field focused.
export const LABEL_FIELD_INDEX = -1;

// null and LABEL_FIELD_INDEX both route digits to labels, so entering the cycle
// forward skips to the first custom field rather than re-highlighting a slot
// that is already the active digit target.
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

type OptionFormField = Extract<FormField, { type: 'category' | 'multicategory' }>;

function digitTargetsOption(field: FormField): field is OptionFormField {
  return field.type === 'category' || field.type === 'multicategory';
}

/** Focuses the first input/textarea inside a field's container, per AnnotationForm's data-form-field-id. */
function focusFormFieldInput(fieldId: number): void {
  const input = document.querySelector<HTMLElement>(
    `[data-form-field-id="${fieldId}"] input, [data-form-field-id="${fieldId}"] textarea`
  );
  input?.focus();
}

/** Digit pressed while `field` is the active custom form field: toggles the
 * matching option on option-valued fields, otherwise focuses the field's input
 * so the digit starts a typed value. */
export function applyFieldDigit(
  field: FormField,
  digitKey: string,
  values: FormValues,
  setValues: (next: FormValues) => void
): void {
  if (!digitTargetsOption(field)) {
    focusFormFieldInput(field.id);
    return;
  }
  const option = field.options[parseInt(digitKey, 10) - 1];
  if (option) setValues(applyCategoryOption(values, field, option.id));
}

export interface FormFieldKeyContext {
  fields: FormField[];
  activeIndex: number | null;
  values: FormValues;
  setValues: (next: FormValues) => void;
  setActiveIndex: (index: number | null) => void;
}

/** Form-field keyboard handling shared by the task-mode and open-mode hooks.
 * Returns true when the event was consumed, so callers can fall through to
 * their own bindings for the same keys (label digits, submit on Enter). */
export function handleFormFieldKey(e: KeyboardEvent, ctx: FormFieldKeyContext): boolean {
  const { fields, activeIndex } = ctx;
  const activeField = activeIndex !== null && activeIndex >= 0 ? fields[activeIndex] : undefined;

  if (activeField && /^[0-9]$/.test(e.key)) {
    e.preventDefault();
    applyFieldDigit(activeField, e.key, ctx.values, ctx.setValues);
    return true;
  }

  if (activeField && e.key === 'Enter' && !digitTargetsOption(activeField)) {
    e.preventDefault();
    focusFormFieldInput(activeField.id);
    return true;
  }

  if (e.key === 'Tab' && fields.length > 0) {
    e.preventDefault();
    ctx.setActiveIndex(cycleFieldIndex(activeIndex, fields.length, e.shiftKey ? -1 : 1));
    return true;
  }

  if (e.key === 'Escape' && activeIndex !== null) {
    e.preventDefault();
    ctx.setActiveIndex(null);
    return true;
  }

  return false;
}
